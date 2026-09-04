import type { AuthUser } from "../core/auth-db"
import type { AuthInternals } from "../core/auth-internals"

/** The columns core is writing to a user row. */
export type UserValues = Partial<Record<string, unknown>>

/**
 * Applies the defined columns of `values` to a user, and returns the row as it
 * now stands.
 *
 * `undefined` means "leave alone" — the rule every implementation used to be
 * asked to honour, now honoured once, here. Stripping it is not cosmetic: a set
 * whose every value was dropped is an `UPDATE` with nothing to `SET`, which
 * most query builders refuse outright. When nothing is left the write is
 * skipped entirely and the existing row is handed straight back, so "this
 * request changed nothing" costs no round trip and cannot fail.
 *
 * `updatedAt` rides along, but only once there is something to write: a request
 * that changed nothing should not move the timestamp the guest sweep reads.
 *
 * The returned user is composed in memory rather than read back: core already
 * holds the row, and `users` has no database-generated column the store would
 * know better than this.
 */
export async function updateUser<T extends AuthUser>(
  internals: AuthInternals,
  user: T,
  values: UserValues
): Promise<T> {
  const defined = Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined)
  )
  if (Object.keys(defined).length === 0) return user

  const stamped = { ...defined, updatedAt: new Date() }
  await internals.db.update({
    table: "users",
    where: { id: { eq: user.id } },
    values: stamped
  })

  return { ...user, ...stamped }
}
