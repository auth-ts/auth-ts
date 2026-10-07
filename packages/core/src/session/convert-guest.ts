import type { AuthUser } from "../core/auth-database"
import type { AuthInternals } from "../core/auth-internals"
import { selectOne } from "../lib/select-one"
import type { FindOrCreateUserInput } from "../user/find-or-create-user"
import { findOrCreateUser } from "../user/find-or-create-user"

/** Identity verified while completing a guest sign-in. */
export type GuestIdentity = FindOrCreateUserInput

/** Result of resolving a guest sign-in. */
export interface GuestConversion {
  user: AuthUser
  created: boolean
}

/** Resolves a guest's verified sign-in identity. */
export async function convertGuest(
  internals: AuthInternals,
  guest: AuthUser,
  input: GuestIdentity
): Promise<GuestConversion> {
  const { identifier, name, image, additionalFields } = input
  const find = () =>
    selectOne(internals, "users", {
      [identifier.kind]: { eq: identifier.value }
    })

  const existing = await find()
  if (existing) {
    if (existing.id === guest.id) {
      return findOrCreateUser(internals, input)
    }
    return mergeGuestInto(internals, guest, existing)
  }

  const values = Object.fromEntries(
    Object.entries({
      ...additionalFields,
      [identifier.kind]: identifier.value,
      name,
      image,
      type: "user",
      updatedAt: new Date()
    }).filter(([, value]) => value !== undefined)
  )

  try {
    const [upgraded] = await internals.db.update({
      table: "users",
      where: {
        id: { eq: guest.id },
        type: { eq: "guest" },
        primaryUserId: { eq: null }
      },
      values
    })
    if (upgraded) {
      internals.log.info("guest upgraded in place, keeping its id and its rows")
      return { user: upgraded, created: true }
    }
  } catch (error) {
    const raced = await find()
    if (!raced) throw error
    return mergeGuestInto(internals, guest, raced)
  }

  return findOrCreateUser(internals, input)
}

/** Records the guest's first merge destination. */
export async function mergeGuestInto(
  internals: AuthInternals,
  guest: AuthUser,
  existing: AuthUser
): Promise<GuestConversion> {
  await internals.db.update({
    table: "users",
    where: {
      id: { eq: guest.id },
      type: { eq: "guest" },
      primaryUserId: { eq: null }
    },
    values: { primaryUserId: existing.id, updatedAt: new Date() }
  })
  internals.log.info("guest sign-in resolved to an existing account")

  return { user: existing, created: false }
}
