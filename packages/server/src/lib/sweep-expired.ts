import type { AuthServerInternals } from "../core/auth-server-internals"

/**
 * Deletes a table's expired rows, riding on the request that is inserting one.
 *
 * Garbage accrues only through inserts, so sweeping at insert time keys the
 * sweep rate to the growth rate — and sweeping the whole table rather than the
 * caller's rows is what collects the tail left by people who never come back.
 * Hygiene, never a security boundary: expiry is enforced on read regardless,
 * which is why a failure is logged rather than allowed to fail a sign-in.
 *
 * With `waitUntil` configured the sweep runs behind the response and there is
 * nothing to await; without it the returned promise must be awaited, because an
 * unawaited promise is not guaranteed to run on Cloudflare Workers once the
 * response has been returned.
 */
export function sweepExpired(
  internals: AuthServerInternals,
  table: "sessions" | "verificationCodes" | "attempts"
) {
  const swept = internals.db
    .delete({ table, where: { expiresAt: { lt: new Date() } } })
    .then(
      () => undefined,
      (error) =>
        internals.log.error("sweep failed", { table, error: String(error) })
    )

  if (internals.config.waitUntil) {
    internals.config.waitUntil(swept)
    return
  }

  return swept
}
