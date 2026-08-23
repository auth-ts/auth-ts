import type { AuthServerInternals } from "../core/auth-server-internals"
import { insertRow } from "../lib/insert-row"
import { selectOne } from "../lib/select-one"

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
  { userId, provider, providerUserId, label }: LinkIdentityInput
) {
  const existing = await selectOne(internals, "identities", {
    provider,
    providerUserId
  })

  if (existing) {
    if (label !== undefined && label !== existing.label) {
      await internals.db.update({
        table: "identities",
        where: { id: existing.id },
        values: { label, updatedAt: new Date() }
      })
    }
    return
  }

  await insertRow(internals, "identities", {
    userId,
    provider,
    providerUserId,
    label: label ?? null
  })
}
