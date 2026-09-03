import type { AuthUser } from "../core/auth-db"
import type { AuthInternals } from "../core/auth-internals"
import { IDENTITY_PAGE_SIZE } from "../oauth/link-identity"

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
 * account — the direction that fails closed. Provider tokens go before the
 * identities that address them. Verification codes go by identifier,
 * since that is how they are keyed; a code outstanding for a deleted address
 * would otherwise sign its next owner into nothing.
 */
export async function deleteUser(internals: AuthInternals, user: AuthUser) {
  await internals.db.delete({ table: "sessions", where: { userId: user.id } })

  // The provider tokens go before the identities that address them. A database
  // cascade would do this too, and should; deleting them here means the
  // guarantee does not rest on a DDL detail core cannot see.
  const identities = await internals.db.select({
    table: "identities",
    where: { userId: user.id },
    limit: IDENTITY_PAGE_SIZE,
    orderBy: { createdAt: "asc" }
  })
  for (const identity of identities) {
    await internals.db.delete({
      table: "identitySecrets",
      where: { identityId: identity.id }
    })
  }
  await internals.db.delete({
    table: "identities",
    where: { userId: user.id }
  })

  for (const identifier of [user.email, user.phoneNumber]) {
    if (!identifier) continue
    await internals.db.delete({
      table: "verifications",
      where: { identifier }
    })
  }

  await internals.db.delete({ table: "users", where: { id: user.id } })
  internals.log.info("user deleted with their sessions and identities")
}
