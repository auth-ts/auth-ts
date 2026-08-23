import type { AuthServerInternals } from "../core/auth-server-internals"
import { selectOne } from "./select-one"

/** Runs hygiene work behind `waitUntil` where there is one, awaited otherwise. */
function hygiene(
  internals: AuthServerInternals,
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
 * With `waitUntil` configured the sweep runs behind the response and there is
 * nothing to await; without it the returned promise must be awaited, because an
 * unawaited promise is not guaranteed to run on Cloudflare Workers once the
 * response has been returned.
 */
export function sweepExpired(
  internals: AuthServerInternals,
  table: "sessions" | "verifications" | "attempts"
) {
  const where = { expiresAt: { lt: new Date() } }
  const swept =
    table === "sessions"
      ? internals.db
          .delete({ table, where })
          .then((removed) => reapOrphanedGuests(internals, removed))
      : internals.db.delete({ table, where })

  return hygiene(internals, "sweep", swept)
}

/**
 * Follows a deletion of sessions: guests whose last session just went are gone.
 *
 * A guest's session is their only credential, so a guest with no sessions is
 * unreachable forever — garbage by definition. Deleting sessions is therefore
 * the one moment an orphan can appear, which is what makes reaping on that
 * signal complete without ever asking the unaskable "which users have no
 * sessions" — a join the database contract deliberately cannot express.
 *
 * Waits like {@link sweepExpired} does, and follows the same rule on failure.
 */
export function reapGuests(
  internals: AuthServerInternals,
  sessions: { userId: string }[]
) {
  if (sessions.length === 0) return

  return hygiene(
    internals,
    "guest reap",
    reapOrphanedGuests(internals, sessions)
  )
}

/**
 * The `where` does the deciding: `type` keeps real accounts safe however the
 * candidate list was produced, and `primaryUserId: null` spares a merged guest
 * whose pointer the application has not migrated yet — even one set between
 * the reads below and this delete.
 */
async function reapOrphanedGuests(
  internals: AuthServerInternals,
  sessions: { userId: string }[]
) {
  if (!internals.config.guest) return

  for (const userId of new Set(sessions.map((session) => session.userId))) {
    const guest = await selectOne(internals, "users", {
      id: userId,
      type: "guest",
      primaryUserId: null
    })
    if (!guest) continue

    // Any remaining session — live or merely unswept — postpones the reap; the
    // sweep that removes the last one re-surfaces this guest as a candidate.
    const remaining = await selectOne(internals, "sessions", { userId })
    if (remaining) continue

    await internals.db.delete({
      table: "users",
      where: { id: userId, type: "guest", primaryUserId: null }
    })
    internals.log.debug("reaped an orphaned guest")
  }
}
