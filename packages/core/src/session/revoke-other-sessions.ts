import type { AuthInternals } from "../core/auth-internals"
import { listUserSessions } from "./list-user-sessions"

/**
 * Signs a user out everywhere except the session making the request.
 *
 * "Everything but this one" is the single query shape the contract cannot
 * express — `where` is equality, and this is an inequality — so core pages
 * through the user's sessions and deletes them by id instead. Each pass reads
 * at most {@link SESSION_PAGE_SIZE} rows and always re-reads from the start,
 * since the previous pass removed what it saw; a pass that deletes nothing is a
 * pass that found only the current session, and ends it.
 *
 * @returns How many sessions were revoked.
 */
export async function revokeOtherSessions(
  internals: AuthInternals,
  userId: string,
  /** The session to keep. */
  currentSessionId: string
) {
  let revoked = 0

  for (;;) {
    const page = await listUserSessions(internals, userId)
    const others = page.filter((session) => session.id !== currentSessionId)
    if (others.length === 0) return revoked

    const deleted = await Promise.all(
      others.map((session) =>
        internals.db.delete({ table: "sessions", where: { id: session.id } })
      )
    )
    const removed = deleted.reduce((sum, rows) => sum + rows.length, 0)
    revoked += removed

    // A pass that saw rows and removed none would page over them forever. That
    // takes a store whose delete does not delete, so it is a bug rather than a
    // race — say so and stop rather than spin.
    if (removed === 0) {
      internals.log.error(
        "delete removed no rows for sessions that a select had just returned"
      )
      return revoked
    }
  }
}
