import type { AuthUser } from "../core/auth-database"
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
 * A read then a write, not an upsert delegated to the store; the semantics
 * that make it subtle live here, in one place, tested once:
 *
 * - **`type` is insert-only.** A sign-in that could rewrite it would demote an
 *   administrator every time they logged in.
 * - **Declared fields are insert-only.** They are sign-up fields; applying them
 *   on every sign-in would make the sign-in body a mass-assignment vector.
 * - **Only `name` and `image` move on a returning sign-in**, and only when
 *   the provider actually sent them. A verification code carries neither, so that path
 *   writes nothing at all rather than issuing an empty update.
 *
 * Two first sign-ins racing both insert; the unique constraint on `email`
 * and `phoneNumber` refuses one, and that one reads back the winner's row.
 */
export async function findOrCreateUser(
  internals: AuthInternals,
  input: FindOrCreateUserInput
): Promise<{ user: AuthUser; created: boolean }> {
  const { identifier, name, image, additionalFields } = input

  const find = () =>
    selectOne(internals, "users", {
      [identifier.kind]: { eq: identifier.value }
    })

  const existing = await find()
  if (existing) {
    return {
      user: await updateUser(internals, existing, { name, image }),
      created: false
    }
  }

  try {
    const user = await insertRow(internals, "users", {
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

    return { user, created: true }
  } catch (error) {
    const raced = await find()
    if (!raced) throw error
    return { user: raced, created: false }
  }
}
