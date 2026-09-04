import type { AuthInternals } from "../core/auth-internals"
import type { RateLimitWindow } from "../core/auth-options"
import { insertRow } from "../lib/insert-row"
import { getIpAddress, getIpAddressKey } from "../lib/ip-address"
import { parseDuration } from "../lib/parse-duration"
import { sweepExpired } from "../lib/sweep-expired"
import { AuthApiError } from "./auth-api-error"

/**
 * Records one attempt against a key and reports how many that key now holds.
 *
 * Append-and-count: every attempt is an insert under a fresh id, and counting
 * is a bounded read. Inserts never conflict, so nothing is read-modify-written
 * and no attempt can be lost — which is what a counter column would need an
 * atomic increment for, and what a generic `update` with literal values could
 * never express.
 *
 * The insert and the read run together, one round-trip rather than two. A read
 * that raced past its own insert simply counts it back in, so this attempt is
 * always in the number — which the callers' accounting depends on.
 *
 * The read is capped at `limit + 1` because core never needs the exact number,
 * only whether more than `limit` exist. That cap is also what keeps an attacker
 * from turning every request into a ten-thousand-row read.
 *
 * @returns The number of attempts on record, saturating at `limit + 1`.
 */
export async function countAttempt(
  internals: AuthInternals,
  key: string,
  expiresAt: Date,
  limit: number
) {
  const [inserted, attempts] = await Promise.all([
    insertRow(internals, "attempts", { key, expiresAt }),
    internals.db.select({
      table: "attempts",
      where: { key: { eq: key } },
      limit: limit + 1,
      orderBy: { id: "asc" }
    })
  ])

  return attempts.some(({ id }) => id === inserted.id)
    ? attempts.length
    : Math.min(attempts.length + 1, limit + 1)
}

/**
 * Counts one request against a fixed window, throwing when the window is full.
 *
 * Fixed windows rather than a token bucket or sliding log: precision at the
 * window boundary buys nothing against the threats here — email flooding and
 * code guessing, both of which are about volume over minutes. The window is
 * part of the key rather than a column, so counting stays an equality read and
 * a window that has passed is simply a set of old rows waiting for the sweep.
 *
 * What this does not promise is exactness. Each request's read sees every
 * insert committed before it ran, so N *simultaneous* requests can each read a
 * number below the cap in the instant before the others land. The overshoot is
 * bounded by one burst's concurrency, it cannot be repeated — the moment the
 * burst settles, the rest of the window is refused — and for the threats these
 * windows exist to stop, "perhaps twenty sends instead of three, once" is not a
 * different security posture. An exact counter would need an atomic increment
 * the contract deliberately does not ask for.
 *
 * @throws {AuthApiError} `rateLimited` with the seconds until the window resets.
 */
export async function checkRateLimit(
  internals: AuthInternals,
  key: string,
  window: RateLimitWindow
) {
  if (internals.config.rateLimit === false) return

  const now = Date.now()
  // Windows are aligned to the clock rather than started by the first request,
  // so every caller counting the same key agrees on which window they are in
  // without reading a stored `resetAt` first.
  const windowMs = parseDuration(window.window)
  const windowStart = Math.floor(now / windowMs) * windowMs
  const endsAt = new Date(windowStart + windowMs)

  const counted = await countAttempt(
    internals,
    `${key}:${windowStart}`,
    endsAt,
    window.max
  )

  // The first attempt of a fresh window sweeps, so under a flood — the moment
  // the table grows fastest — the sweep still runs once per key per window
  // rather than once per request.
  if (counted === 1) await sweepExpired(internals, "attempts")

  // The count includes this request, so the cap is exceeded at max + 1 — and a
  // refused request is still counted, which is what stops a caller who is
  // already over the limit from getting a fresh allowance by continuing.
  if (counted > window.max) {
    const retryAfter = Math.max(1, Math.ceil((endsAt.getTime() - now) / 1000))
    internals.log.warn("rate limit exceeded", { key: key.split(":")[0] })

    throw new AuthApiError("rateLimited", 429, { retryAfter })
  }
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
