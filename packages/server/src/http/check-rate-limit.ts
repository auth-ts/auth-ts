import type { AuthServerInternals } from "../core/auth-server-internals"
import type { RateLimitWindow } from "../core/auth-server-options"
import { getIpAddress, getIpAddressKey } from "../lib/ip-address"
import { parseDuration } from "../lib/parse-duration"
import { AuthApiError } from "./auth-api-error"

/**
 * Counts one request against a fixed window, throwing when the window is full.
 *
 * Fixed windows rather than a token bucket or sliding log: the counter is a
 * single row the consumer's database already knows how to upsert, and precision
 * at the window boundary buys nothing against the threats here — email flooding
 * and code guessing, both of which are about volume over minutes.
 *
 * The count is never read here. A read-then-write would let a burst of parallel
 * requests all see the same value and each write back `count + 1`, so ten
 * requests register as one — which is precisely the attack a limiter exists to
 * stop. Instead the store does the increment atomically in `upsertRateLimit`
 * and hands back the result; this function only compares it to the cap.
 *
 * @throws {AuthApiError} `rateLimited` with the seconds until the window resets.
 */
export async function checkRateLimit(
  internals: AuthServerInternals,
  key: string,
  window: RateLimitWindow
) {
  if (internals.config.rateLimit === false) return

  const now = Date.now()
  const counted = await internals.db.upsertRateLimit({
    key,
    resetAt: new Date(now + parseDuration(window.window))
  })

  // The returned count includes this request, so the cap is exceeded at
  // max + 1 — and requests refused here are still counted, which is what a
  // single atomic increment naturally gives.
  if (counted.count > window.max) {
    const retryAfter = Math.max(
      1,
      Math.ceil((counted.resetAt.getTime() - now) / 1000)
    )
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
  internals: AuthServerInternals,
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
