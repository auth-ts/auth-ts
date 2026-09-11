import type { AuthIdentity, AuthIdentitySecret } from "../core/auth-database"
import type { AuthInternals } from "../core/auth-internals"
import { encryptSecret } from "../lib/encrypt"
import { insertRow } from "../lib/insert-row"
import { selectOne } from "../lib/select-one"
import type {
  ProviderIdentity,
  ProviderTokens
} from "./providers/oauth-provider"

/**
 * How many linked providers core reads at a time.
 *
 * The ceiling every read the contract accepts must have. Nobody links more
 * providers than this; a `userId` that somehow matched more has a problem the
 * identities screen is not going to solve.
 */
export const IDENTITY_PAGE_SIZE = 100

/**
 * The stored form of a grant, split across the two tables that hold it.
 *
 * Exported because refreshing writes the same columns as linking does, and the
 * two must not drift into encrypting different things.
 */
export async function encryptTokens(
  secret: string,
  tokens: ProviderTokens
): Promise<{
  identity: Partial<AuthIdentity>
  secrets: Partial<AuthIdentitySecret>
}> {
  return {
    identity: {
      ...(tokens.scope ? { scope: tokens.scope } : {})
    },
    secrets: {
      ...(tokens.accessToken
        ? {
            accessTokenEncrypted: await encryptSecret(
              secret,
              tokens.accessToken
            )
          }
        : {}),
      ...(tokens.refreshToken
        ? {
            refreshTokenEncrypted: await encryptSecret(
              secret,
              tokens.refreshToken
            )
          }
        : {}),
      ...(tokens.accessTokenExpiresAt
        ? { accessTokenExpiresAt: tokens.accessTokenExpiresAt }
        : {}),
      ...(tokens.refreshTokenExpiresAt
        ? { refreshTokenExpiresAt: tokens.refreshTokenExpiresAt }
        : {})
    }
  }
}

/**
 * Writes a grant's encrypted halves, creating the row on first connect.
 *
 * `existing` is the secrets row when the caller has already read it, `null`
 * when it knows there is none, and omitted to read it here.
 */
export async function storeIdentitySecrets(
  internals: AuthInternals,
  identityId: string,
  secrets: Partial<AuthIdentitySecret>,
  existing?: AuthIdentitySecret | null
) {
  if (Object.keys(secrets).length === 0) return

  const row =
    existing === undefined
      ? await selectOne(internals, "identitySecrets", {
          identityId: { eq: identityId }
        })
      : existing
  if (row) {
    await internals.db.update({
      table: "identitySecrets",
      where: { id: { eq: row.id } },
      values: { ...secrets, updatedAt: new Date() }
    })
    return
  }

  await insertRow(internals, "identitySecrets", { identityId, ...secrets })
}

/**
 * Records a provider identity against a user, or refreshes the one on file.
 *
 * Keyed on the provider's stable account id rather than on the label: people
 * change their email at the provider, and matching on it quietly creates a
 * second account for the same person.
 *
 * The label is written only when the provider actually sent one. A provider
 * with no verified email would otherwise produce an update with nothing to set
 * — an error in most query builders, and the one flow where it happens is a
 * routine sign-in.
 *
 * The race between the read and the insert is settled by the uniqueness the
 * contract requires on `(provider, providerUserId)`: two callbacks for one
 * provider account both find nothing, both insert, and the constraint refuses
 * the loser rather than letting one identity link twice.
 */
export async function linkIdentity(
  internals: AuthInternals,
  userId: string,
  provider: string,
  { providerUserId, label, tokens }: ProviderIdentity
) {
  const [existing, stored] = await Promise.all([
    selectOne(internals, "identities", {
      provider: { eq: provider },
      providerUserId: { eq: providerUserId }
    }),
    tokens
      ? encryptTokens(internals.config.secret, tokens)
      : { identity: {}, secrets: {} }
  ])

  if (existing) {
    // Both halves, not just the label: a sign-in that changes nothing about the
    // name still arrives with a fresh grant, and that is the write worth making.
    const values = {
      ...(label && label !== existing.label ? { label } : {}),
      ...stored.identity
    }
    await Promise.all([
      Object.keys(values).length > 0
        ? internals.db.update({
            table: "identities",
            where: { id: { eq: existing.id } },
            values: { ...values, updatedAt: new Date() }
          })
        : undefined,
      storeIdentitySecrets(internals, existing.id, stored.secrets)
    ])
    return
  }

  const identity = await insertRow(internals, "identities", {
    userId,
    provider,
    providerUserId,
    label: label || null,
    ...stored.identity
  })
  await storeIdentitySecrets(internals, identity.id, stored.secrets, null)
}
