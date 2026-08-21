import type { AuthUser } from "../core/auth-db.ts"
import type { AuthServerInternals } from "../core/auth-server-internals.ts"
import { AuthApiError } from "../http/auth-api-error.ts"
import type { ProviderIdentity } from "./providers/oauth-provider.ts"

/**
 * Finds or creates the user behind a verified provider identity.
 *
 * The cascade, in order:
 *
 * 1. **An existing connection for this provider account id.** The stable id
 *    match comes first so that someone who changed their email at the provider
 *    still lands in their own account instead of a new one.
 * 2. **A verified email that already belongs to a user.** They are the same
 *    person, so the accounts are joined and the connection recorded.
 * 3. **Neither.** Create the user, then record the connection.
 *
 * A phone number is never consulted: providers do not supply one, and linking by
 * phone is the `connect` flow, which the signed-in user initiates deliberately.
 *
 * @throws {AuthApiError} `unauthenticated` when the provider gave no verified email
 * and there is no existing connection to fall back on.
 */
export async function resolveOAuthUser(
  internals: AuthServerInternals,
  provider: string,
  identity: ProviderIdentity,
  additionalFields: Record<string, string | number | boolean> = {}
): Promise<AuthUser> {
  const connection = await internals.db.getConnection({
    provider,
    providerAccountId: identity.providerAccountId
  })

  if (connection) {
    const linked = await internals.db.getUser({ id: connection.userId })
    if (linked) {
      // Refresh the recorded email, but never re-key on it.
      await internals.db.upsertConnection({
        userId: linked.id,
        provider,
        providerAccountId: identity.providerAccountId,
        ...(identity.email ? { email: identity.email } : {})
      })

      return linked
    }
  }

  if (!identity.email) {
    internals.log.warn(
      "oauth identity had no verified email and no existing connection",
      { provider }
    )
    throw new AuthApiError("unauthenticated", 403)
  }

  // Merge semantics: an existing magic-code user picks up a name and picture on
  // their first OAuth sign-in, without those overwriting anything already set.
  const user = await internals.db.upsertUser({
    email: identity.email,
    type: "user",
    ...(identity.name ? { name: identity.name } : {}),
    ...(identity.imageURL ? { imageURL: identity.imageURL } : {}),
    ...(Object.keys(additionalFields).length > 0 ? { additionalFields } : {})
  })

  await internals.db.upsertConnection({
    userId: user.id,
    provider,
    providerAccountId: identity.providerAccountId,
    email: identity.email
  })

  return user
}
