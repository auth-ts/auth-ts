import type { AuthServerInternals } from "../core/auth-server-internals.ts"
import type { RateLimitWindow } from "../core/auth-server-options.ts"
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
export declare function checkRateLimit(
  internals: AuthServerInternals,
  key: string,
  window: RateLimitWindow
): Promise<void>
//# sourceMappingURL=check-rate-limit.d.ts.map
