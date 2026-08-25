import type { AuthIdentity, AuthIdentitySecret } from "../core/auth-db"
import type { AuthServerInternals } from "../core/auth-server-internals"
import { encryptSecret } from "../lib/encrypt"
import { insertRow } from "../lib/insert-row"
import { selectOne } from "../lib/select-one"
import type { ProviderTokens } from "./providers/oauth-provider"

/**
 * How many linked providers core reads at a time.
 *
 * The ceiling every read the contract accepts must have. Nobody links more
 * providers than this; a `userId` that somehow matched more has a problem the
 * identities screen is not going to solve.
 */
export const IDENTITY_PAGE_SIZE = 100

/** A provider identity to record against a user. */
export interface LinkIdentityInput {
  userId: string
  provider: string
  providerUserId: string
  /** Display only. Recorded when present, left alone when the provider sent none. */
  label?: string
  /**
   * The grant this flow produced. Each field is recorded when present and left
   * alone when absent — a refresh that returns no new refresh token must not
   * erase the one on file.
   */
  tokens?: ProviderTokens
}

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
      ...(tokens.refreshTokenExpiresAt
        ? { refreshTokenExpiresAt: tokens.refreshTokenExpiresAt }
        : {}),
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
        : {})
    }
  }
}

/** Writes a grant's encrypted halves, creating the row on first connect. */
export async function storeIdentitySecrets(
  internals: AuthServerInternals,
  identityId: string,
  secrets: Partial<AuthIdentitySecret>
) {
  if (Object.keys(secrets).length === 0) return

  const existing = await selectOne(internals, "identitySecrets", { identityId })
  if (existing) {
    await internals.db.update({
      table: "identitySecrets",
      where: { id: existing.id },
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
  internals: AuthServerInternals,
  { userId, provider, providerUserId, label, tokens }: LinkIdentityInput
) {
  const existing = await selectOne(internals, "identities", {
    provider,
    providerUserId
  })
  const stored = tokens
    ? await encryptTokens(internals.config.secret, tokens)
    : { identity: {}, secrets: {} }

  if (existing) {
    // Both halves, not just the label: a sign-in that changes nothing about the
    // name still arrives with a fresh grant, and that is the write worth making.
    const values = {
      ...(label !== undefined && label !== existing.label ? { label } : {}),
      ...stored.identity
    }
    if (Object.keys(values).length > 0) {
      await internals.db.update({
        table: "identities",
        where: { id: existing.id },
        values: { ...values, updatedAt: new Date() }
      })
    }
    await storeIdentitySecrets(internals, existing.id, stored.secrets)
    return
  }

  const identity = await insertRow(internals, "identities", {
    userId,
    provider,
    providerUserId,
    label: label ?? null,
    ...stored.identity
  })
  await storeIdentitySecrets(internals, identity.id, stored.secrets)
}
