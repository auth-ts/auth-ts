import type { AuthUser } from "../core/auth-db"
import type { AuthInternals } from "../core/auth-internals"
import type { AdditionalFieldValues } from "../http/validate-additional-fields"
import { insertRow } from "../lib/insert-row"
import { selectOne } from "../lib/select-one"
import { updateUser } from "./update-user"

/** Which identifier a sign-in proved, and its normalized value. */
export interface UserIdentifier {
  kind: "email" | "phoneNumber"
  value: string
}

/** What a sign-in knows about the person behind the identifier. */
export interface FindOrCreateUserInput {
  identifier: UserIdentifier
  name?: string
  image?: string
  /** Validated sign-up fields. Applied on create only — see below. */
  additionalFields?: AdditionalFieldValues
}

/**
 * Resolves the user behind a proven identifier, creating them on first sign-in.
 *
 * This is the read-then-write that used to be an upsert delegated to the store,
 * and the semantics that made that upsert subtle now live here, in one place,
 * tested once:
 *
 * - **`type` is insert-only.** A sign-in that could rewrite it would demote an
 *   administrator every time they logged in.
 * - **Declared fields are insert-only.** They are sign-up fields; applying them
 *   on every sign-in would make the sign-in body a mass-assignment vector.
 * - **Only `name` and `image` move on a returning sign-in**, and only when
 *   the provider actually sent them. A verification code carries neither, so that path
 *   writes nothing at all rather than issuing an empty update.
 *
 * The race this opens — two first sign-ins for one address, both reading
 * nothing, both inserting — is closed by the unique constraint the contract
 * requires on `email` and `phoneNumber`. The loser gets a constraint violation
 * and a failed request; without the constraint it would get a second account.
 */
export async function findOrCreateUser(
  internals: AuthInternals,
  input: FindOrCreateUserInput
): Promise<AuthUser> {
  const { identifier, name, image, additionalFields } = input

  const existing = await selectOne(internals, "users", {
    [identifier.kind]: { eq: identifier.value }
  })
  if (existing) return updateUser(internals, existing, { name, image })

  return insertRow(internals, "users", {
    email: null,
    phoneNumber: null,
    name: null,
    image: null,
    primaryUserId: null,
    ...additionalFields,
    [identifier.kind]: identifier.value,
    ...(name === undefined ? {} : { name }),
    ...(image === undefined ? {} : { image }),
    type: "user"
  })
}
