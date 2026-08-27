import type { AuthUser } from "../core/auth-db"
import type { AuthServerInternals } from "../core/auth-server-internals"
import type { AdditionalFieldValues } from "../http/validate-additional-fields"
import { selectOne } from "../lib/select-one"
import { updateUser } from "../user/update-user"

/** Identity details learned during a sign-in that a guest is completing. */
export interface GuestIdentity {
  email?: string
  phoneNumber?: string
  name?: string
  image?: string
  /**
   * Validated sign-up fields from the request.
   *
   * Applied when the guest is upgraded in place — that is the moment their
   * real account comes into being, which is what sign-up fields are for.
   * Dropped on a merge: the existing account wins and nothing is created, so
   * there is no sign-up for them to belong to.
   */
  additionalFields?: AdditionalFieldValues
}

/** The outcome of converting a guest. */
export interface GuestConversion {
  /** The user the new session belongs to. */
  user: AuthUser
  /**
   * `"upgraded"` — the guest row became a real user, keeping its id.
   * `"merged"` — the identifier already belonged to someone, so the guest points at them.
   */
  outcome: "upgraded" | "merged"
}

/**
 * Completes a sign-in performed by someone currently signed in as a guest.
 *
 * Two cases, and the difference matters enormously to the data they created:
 *
 * **The identifier is new** — the guest row is upgraded in place. Same id, so
 * every row they already own under row-level security stays theirs with no
 * migration at all. This is the case worth optimising for, and why guests are
 * full users rather than a separate table.
 *
 * **The identifier already belongs to someone** — that account wins, and the
 * guest row records `primaryUserId` pointing at it. Core does not move any data:
 * only the application knows what a guest's rows mean or whether merging them is
 * even desirable.
 *
 * In both cases the guest's session is replaced rather than parked: callers pass
 * its token hash as `issueSession`'s `replaces`, which deletes the row and keeps
 * it out of the account switcher. A stranded anonymous account in a switcher
 * helps nobody, and a still-valid refresh token for it is a session nobody can
 * see to revoke.
 */
export async function convertGuest(
  internals: AuthServerInternals,
  guest: AuthUser,
  identity: GuestIdentity
): Promise<GuestConversion> {
  const existing = identity.email
    ? await selectOne(internals, "users", { email: identity.email })
    : identity.phoneNumber
      ? await selectOne(internals, "users", {
          phoneNumber: identity.phoneNumber
        })
      : null

  if (existing && existing.id !== guest.id) {
    return mergeGuestInto(internals, guest, existing)
  }

  // The one place `type` legitimately changes: an anonymous row becoming the
  // real account it always was.
  const upgraded = await updateUser(internals, guest, {
    ...identity.additionalFields,
    type: "user",
    email: identity.email,
    phoneNumber: identity.phoneNumber,
    name: identity.name,
    image: identity.image
  })
  internals.log.info("guest upgraded in place, keeping its id and its rows")

  return { user: upgraded, outcome: "upgraded" }
}

/**
 * Points a guest at the account that turned out to be theirs.
 *
 * Shared with OAuth, where the account is found by provider identity rather
 * than by identifier, so that every way a guest can resolve to an existing user
 * leaves the same `primaryUserId` breadcrumb for the application to act on.
 */
export async function mergeGuestInto(
  internals: AuthServerInternals,
  guest: AuthUser,
  existing: AuthUser
): Promise<GuestConversion> {
  await updateUser(internals, guest, { primaryUserId: existing.id })
  internals.log.info("guest sign-in resolved to an existing account")

  return { user: existing, outcome: "merged" }
}
