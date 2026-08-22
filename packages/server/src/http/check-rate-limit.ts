import type { AuthServerInternals } from "../core/auth-server-internals.ts"
import type { RateLimitWindow } from "../core/auth-server-options.ts"
import { parseDuration } from "../lib/parse-duration.ts"
import { AuthApiError } from "./auth-api-error.ts"

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
