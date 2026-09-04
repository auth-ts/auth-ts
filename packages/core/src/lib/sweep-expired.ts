import type { AuthInternals } from "../core/auth-internals"

/** Runs hygiene work behind `waitUntil` where there is one, awaited otherwise. */
function hygiene(
  internals: AuthInternals,
  label: string,
  work: Promise<unknown>
) {
  const settled = work.then(
    () => undefined,
    (error) => internals.log.error(`${label} failed`, { error: String(error) })
  )

  if (internals.config.waitUntil) {
    internals.config.waitUntil(settled)
    return
  }

  return settled
}

/**
 * Deletes a table's expired rows, riding on the request that is inserting one.
 *
 * Garbage accrues only through inserts, so sweeping at insert time keys the
 * sweep rate to the growth rate — and sweeping the whole table rather than the
 * caller's rows is what collects the tail left by people who never come back.
 * Hygiene, never a security boundary: expiry is enforced on read regardless,
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
  table: "sessions" | "verifications" | "attempts"
) {
  return hygiene(
    internals,
    "sweep",
    internals.db.delete({ table, where: { expiresAt: { lt: new Date() } } })
  )
}
