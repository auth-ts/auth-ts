import type { AuthUser } from "../core/auth-db"
import type { AuthInternals } from "../core/auth-internals"
import { AuthApiError } from "../http/auth-api-error"
import { selectOne } from "../lib/select-one"
import { convertGuest, mergeGuestInto } from "../session/convert-guest"
import { findOrCreateUser } from "../user/find-or-create-user"
import { linkIdentity } from "./link-identity"
import type { ProviderIdentity } from "./providers/oauth-provider"

/** What shapes how a provider identity resolves to a user. */
export interface ResolveOAuthUserOptions {
  /** Consumer-declared fields for a user created by this sign-in. */
  additionalFields?: Record<string, string | number | boolean>
  /**
   * The guest currently signed in, if any. A guest never causes a new user to be
   * created: they are upgraded in place, or merged into the account the identity
   * already belongs to.
   */
  guest?: AuthUser
}

/**
 * Finds or creates the user behind a verified provider identity.
 *
 * The cascade, in order:
 *
 * 1. **An existing identity for this provider account id.** The stable id
 *    match comes first so that someone who changed their email at the provider
 *    still lands in their own account instead of a new one. A guest merges into
 *    that account; the identity itself is never re-pointed.
 * 2. **A verified email that already belongs to a user.** They are the same
 *    person, so the accounts are joined and the identity recorded. A guest
 *    merges into that account, or — if the email is new — is upgraded in place.
 * 3. **Neither.** Create the user (or upgrade the guest), then record the
 *    identity.
 *
 * A phone number is never consulted: providers do not supply one, and linking by
 * phone is the `connect` flow, which the signed-in user initiates deliberately.
 *
 * @throws {AuthApiError} `unauthenticated` when the provider gave no verified email
 * and there is no existing identity to fall back on.
 */
export async function resolveOAuthUser(
  internals: AuthInternals,
  provider: string,
  identity: ProviderIdentity,
  { additionalFields = {}, guest }: ResolveOAuthUserOptions = {}
): Promise<AuthUser> {
  const existing = await selectOne(internals, "identities", {
    provider,
    providerUserId: identity.providerUserId
  })

  if (existing) {
    const linked = await selectOne(internals, "users", {
      id: existing.userId
    })
    if (linked) {
      // Refresh the recorded label, but never re-key on it: the account is
      // found by the provider's stable id, so a renamed handle is the same
      // link with a new name on it.
      await linkIdentity(internals, {
        userId: linked.id,
        provider,
        providerUserId: identity.providerUserId,
        ...(identity.label ? { label: identity.label } : {}),
        ...(identity.tokens ? { tokens: identity.tokens } : {})
      })

      if (guest && guest.id !== linked.id) {
        return (await mergeGuestInto(internals, guest, linked)).user
      }

      return linked
    }
  }

  if (!identity.email) {
    internals.log.warn(
      "oauth identity had no verified email and no existing identity",
      { provider }
    )
    throw new AuthApiError("providerEmailUnverified", 403)
  }

  // Merge semantics: an existing verification-code user picks up a name and picture on
  // their first OAuth sign-in, without those overwriting anything already set.
  const user = guest
    ? (
        await convertGuest(internals, guest, {
          email: identity.email,
          ...(identity.name ? { name: identity.name } : {}),
          ...(identity.image ? { image: identity.image } : {}),
          additionalFields
        })
      ).user
    : await findOrCreateUser(internals, {
        identifier: { kind: "email", value: identity.email },
        ...(identity.name ? { name: identity.name } : {}),
        ...(identity.image ? { image: identity.image } : {}),
        additionalFields
      })

  await linkIdentity(internals, {
    userId: user.id,
    provider,
    providerUserId: identity.providerUserId,
    ...(identity.label ? { label: identity.label } : {}),
    ...(identity.tokens ? { tokens: identity.tokens } : {})
  })

  return user
}
