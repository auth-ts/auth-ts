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
 * @throws {AuthApiError} `rateLimited` with the seconds until the window resets.
 */
export async function checkRateLimit(
  internals: AuthServerInternals,
  key: string,
  window: RateLimitWindow
) {
  if (internals.options.rateLimit === false) return

  const now = Date.now()
  const existing = await internals.db.getRateLimit({ key })

  if (!existing || existing.resetAt.getTime() <= now) {
    await internals.db.upsertRateLimit({
      key,
      count: 1,
      resetAt: new Date(now + parseDuration(window.window))
    })
    return
  }

  if (existing.count >= window.max) {
    const retryAfter = Math.max(
      1,
      Math.ceil((existing.resetAt.getTime() - now) / 1000)
    )
    internals.log.warn("rate limit exceeded", { key: key.split(":")[0] })

    throw new AuthApiError("rateLimited", 429, { retryAfter })
  }

  await internals.db.upsertRateLimit({
    key,
    count: existing.count + 1,
    resetAt: existing.resetAt
  })
}
