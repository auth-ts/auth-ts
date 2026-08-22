import type { AuthUser } from "../core/auth-db"
import type { AuthServerInternals } from "../core/auth-server-internals"

/**
 * Deletes a user and everything of theirs core owns.
 *
 * Core deletes the children itself rather than requiring `ON DELETE CASCADE`,
 * because a forgotten cascade is silent until a deleted account signs in with a
 * refresh token that still works. Three extra deletes cost nothing and remove
 * the requirement from the contract entirely.
 *
 * The order is the safety property. Sessions go first, so a failure part-way
 * through leaves an account with no live token rather than a live token with no
 * account — the direction that fails closed. Verification codes go by identifier,
 * since that is how they are keyed; a code outstanding for a deleted address
 * would otherwise sign its next owner into nothing.
 */
export async function deleteUser(
  internals: AuthServerInternals,
  user: AuthUser
) {
  await internals.db.delete({ table: "sessions", where: { userId: user.id } })
  await internals.db.delete({
    table: "connections",
    where: { userId: user.id }
  })

  for (const identifier of [user.email, user.phoneNumber]) {
    if (!identifier) continue
    await internals.db.delete({
      table: "verificationCodes",
      where: { identifier }
    })
  }

  await internals.db.delete({ table: "users", where: { id: user.id } })
  internals.log.info("user deleted with their sessions and connections")
}
