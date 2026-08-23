import type { AuthUser } from "@auth-ts/server"

/**
 * Turns a user's timestamps into the `Date`s its type says they are.
 *
 * JSON has no date, so what arrives is a string wearing the row's type. The
 * parameter is typed as the destination rather than the wire shape because
 * `AuthUser` carries an index signature for additional fields, and `Omit`ting
 * two keys from it erases every declared field along with them.
 */
export function reviveUser(user: AuthUser): AuthUser {
  return {
    ...user,
    createdAt: new Date(user.createdAt),
    updatedAt: new Date(user.updatedAt)
  }
}
