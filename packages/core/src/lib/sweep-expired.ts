import type { AuthInternals } from "../core/auth-internals"
import { defer } from "./defer"

/**
 * Deletes a table's rows past their lifetime, riding on the request that is
 * inserting one.
 *
 * Lifetimes live in code and rows only record when, so the caller says which
 * timestamp and how old; a row is dead the moment a read stops accepting it,
 * and this collects it later. Garbage accrues only through inserts, so
 * sweeping at insert time keys the sweep rate to the growth rate — and
 * sweeping the whole table rather than the caller's rows is what collects the
 * tail left by people who never come back. Hygiene, never a security boundary,
 * which is why a failure is logged rather than allowed to fail a sign-in.
 *
 * Only the library's own tables are swept. A `users` row this leaves behind —
 * a guest whose last session expired — is yours to collect on your own
 * schedule, the same way {@link AuthUser.primaryUserId} leaves a merged guest's
 * data where it is.
 *
 * With `waitUntil` configured the sweep runs behind the response and there is
 * nothing to await; without it the returned promise must be awaited, because an
 * unawaited promise is not guaranteed to run on Cloudflare Workers once the
 * response has been returned.
 */
export function sweepExpired(
  internals: AuthInternals,
  table: "sessions" | "verifications" | "rateLimits",
  where: { createdAt: { lt: Date } } | { updatedAt: { lt: Date } }
) {
  return defer(internals, "sweep", internals.db.delete({ table, where }))
}
