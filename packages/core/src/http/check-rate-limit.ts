import { DEFAULT_GUESSES } from "../core/auth-config"
import type { AuthInternals } from "../core/auth-internals"
import type { RateLimitBucket } from "../core/auth-options"
import { insertRow } from "../lib/insert-row"
import { getIpAddress, getIpAddressKey } from "../lib/ip-address"
import { parseDuration } from "../lib/parse-duration"
import { selectOne } from "../lib/select-one"
import { sweepExpired } from "../lib/sweep-expired"
import { AuthApiError } from "./auth-api-error"

/** How many lost races a consume tolerates before refusing. */
const TRIES = 3

/**
 * Takes one token from a bucket, throwing when it is empty.
 *
 * A token bucket rather than a window, as the book asks: `capacity` tokens,
 * one back every `refill`, so a user who typed one wrong code tries again a
 * minute later instead of waiting for a window to end. The bucket is a row —
 * `tokenCount` and `lastRefilledAt` — because on a serverless runtime memory
 * is not shared between requests.
 *
 * Consuming is a read and a conditional write. The update names the
 * `tokenCount` and `lastRefilledAt` it read, so two requests that read the
 * same bucket cannot both take the last token: the second finds the row
 * changed, writes nothing, and reads again. Both values came back from the
 * store, so a timestamp column of any precision compares equal to itself. A
 * missing row is inserted with one token spent; two requests that both found
 * nothing are settled by the unique index on `key`. Losing every retry refuses
 * the request, which is the safe direction.
 *
 * A refused request writes nothing. A bucket that has refilled is the same as
 * no row, and the first request on a fresh key deletes every row old enough
 * to be full — so the table holds only buckets in use.
 *
 * @throws {AuthApiError} `rateLimited` with the seconds until the next token.
 */
export async function checkRateLimit(
  internals: AuthInternals,
  key: string,
  bucket: RateLimitBucket
) {
  const refillInterval = parseDuration(bucket.refill)

  for (let attempt = 0; attempt < TRIES; attempt++) {
    const now = new Date()
    const node = await selectOne(internals, "rateLimits", { key: { eq: key } })

    if (!node) {
      try {
        await insertRow(internals, "rateLimits", {
          key,
          tokenCount: bucket.capacity - 1,
          lastRefilledAt: now
        })
      } catch {
        continue
      }
      const { rateLimit } = internals.config
      const buckets =
        rateLimit === false ? [DEFAULT_GUESSES] : Object.values(rateLimit)
      const fullAfter = Math.max(
        ...buckets.map(
          ({ capacity, refill }) => capacity * parseDuration(refill)
        )
      )
      await sweepExpired(internals, "rateLimits", {
        updatedAt: { lt: new Date(now.getTime() - fullAfter) }
      })
      return
    }

    // Bucket arithmetic from the author's limit.go
    const tokenRefillCount = Math.floor(
      (now.getTime() - node.lastRefilledAt.getTime()) / refillInterval
    )
    const tokenCount = Math.min(
      node.tokenCount + tokenRefillCount,
      bucket.capacity
    )
    const lastRefilledAt = new Date(
      node.lastRefilledAt.getTime() + refillInterval * tokenRefillCount
    )

    if (tokenCount < 1) {
      const retryAfter = Math.max(
        1,
        Math.ceil(
          (lastRefilledAt.getTime() + refillInterval - now.getTime()) / 1000
        )
      )
      internals.log.warn("rate limit exceeded", { key: key.split(":")[0] })
      throw new AuthApiError("rateLimited", { retryAfter })
    }

    const [written] = await internals.db.update({
      table: "rateLimits",
      where: {
        id: { eq: node.id },
        tokenCount: { eq: node.tokenCount },
        lastRefilledAt: { eq: node.lastRefilledAt }
      },
      values: { tokenCount: tokenCount - 1, lastRefilledAt, updatedAt: now }
    })
    if (written) return
  }

  internals.log.warn("rate limit contended", { key: key.split(":")[0] })
  throw new AuthApiError("rateLimited", { retryAfter: 1 })
}

/**
 * The per-IP rate-limit key for a request, or `undefined` when no address could
 * be trusted and the limit therefore does not apply.
 *
 * The key is the address grouped by {@link IpAddressOptions.ipv6Subnet}, not
 * the address itself, so an IPv6 client cannot spend its prefix on fresh
 * buckets. Whether a limit applies at all is decided here rather than at each
 * call site, and the one case that is easy to miss in production — a deployment
 * where nothing usable ever arrives, leaving the limits configured and inert —
 * is said out loud the first time it happens.
 *
 * Requests are never funnelled into a single shared bucket when the address is
 * unknown: one caller could then lock every user out of the flow, which is a
 * worse outcome than the per-identifier limits carrying it alone.
 */
export function ipRateLimitKey(
  internals: AuthInternals,
  headers: Headers,
  scope: string
): string | undefined {
  const { config } = internals
  const address = getIpAddress(headers, config.ipAddress)

  if (!address) {
    if (!config.ipAddress.disableTracking) {
      internals.warnOnce(
        "ip-address",
        "no client IP could be derived from the request, so per-IP rate limits do not apply and session.ipAddress will be null. " +
          "Point ipAddress.headers at the header your platform sets (cf-connecting-ip on Cloudflare, x-forwarded-for elsewhere), " +
          "or declare ipAddress.trustedProxies when a proxy chain reaches this server.",
        { headers: config.ipAddress.headers }
      )
    }
    return undefined
  }

  return `${scope}:ip:${getIpAddressKey(address, config.ipAddress)}`
}
