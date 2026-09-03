import type { AdditionalFieldsSchema, AuthRow } from "../core/auth-db"
import type { AuthInternals } from "../core/auth-internals"

/**
 * How many sessions core reads at a time.
 *
 * Every read the contract accepts has a ceiling, and this is the one for a
 * person's devices: high enough that nobody real is truncated, low enough that
 * a table with a runaway `userId` cannot turn one request into an unbounded
 * read. Revocation pages with the same number.
 */
export const SESSION_PAGE_SIZE = 100

/** Reads a page of a user's sessions, newest first. */
export function listUserSessions(
  internals: AuthInternals,
  userId: string
): Promise<AuthRow<AdditionalFieldsSchema, "sessions">[]> {
  return internals.db.select({
    table: "sessions",
    where: { userId },
    limit: SESSION_PAGE_SIZE,
    orderBy: { createdAt: "desc" }
  })
}
