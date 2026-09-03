import { describe, expect, it, vi } from "vitest"
import { findOrCreateUser } from "../../src/user/find-or-create-user"
import { createTestInternals } from "../helpers/create-test-internals"
import { insertUser, selectRows } from "../helpers/rows"

const ada = { kind: "email", value: "ada@example.com" } as const

describe("findOrCreateUser", () => {
  it("creates the user on a first sign-in, with the columns core owns spelled out", async () => {
    const { internals, db } = await createTestInternals()

    const user = await findOrCreateUser(internals, { identifier: ada })

    expect(user.email).toBe("ada@example.com")
    expect(user.type).toBe("user")
    expect(user.phoneNumber).toBeNull()
    expect(db.users()).toHaveLength(1)
  })

  it("returns the same user on the next sign-in rather than creating a second", async () => {
    const { internals, db } = await createTestInternals()

    const first = await findOrCreateUser(internals, { identifier: ada })
    const second = await findOrCreateUser(internals, { identifier: ada })

    expect(second.id).toBe(first.id)
    expect(db.users()).toHaveLength(1)
  })

  it("writes nothing when the sign-in carries no profile fields", async () => {
    // A verification code carries neither a name nor a picture, so this is the common
    // path — and an update with nothing to set is an error in most query
    // builders, which is exactly how this used to fail against a real database.
    const { internals, db } = await createTestInternals()
    await findOrCreateUser(internals, { identifier: ada })
    const update = vi.spyOn(db, "update")

    await findOrCreateUser(internals, { identifier: ada })

    expect(update).not.toHaveBeenCalled()
  })

  it("moves name and image on a returning sign-in when the provider sent them", async () => {
    const { internals } = await createTestInternals()
    await findOrCreateUser(internals, { identifier: ada, name: "Ada" })

    const updated = await findOrCreateUser(internals, {
      identifier: ada,
      name: "Ada Lovelace",
      image: "https://img.example/a.png"
    })

    expect(updated.name).toBe("Ada Lovelace")
    expect(updated.image).toBe("https://img.example/a.png")
  })

  it("never rewrites type, so signing in cannot demote an administrator", async () => {
    const { internals, db } = await createTestInternals()
    await insertUser(db, { email: "admin@example.com", type: "admin" })

    const signedIn = await findOrCreateUser(internals, {
      identifier: { kind: "email", value: "admin@example.com" }
    })

    expect(signedIn.type).toBe("admin")
  })

  it("applies declared fields on create only, so a sign-in body cannot rewrite them", async () => {
    const { internals } = await createTestInternals({
      user: { additionalFields: { plan: "string" } }
    })

    const created = await findOrCreateUser(internals, {
      identifier: ada,
      additionalFields: { plan: "pro" }
    })
    const signedIn = await findOrCreateUser(internals, {
      identifier: ada,
      additionalFields: { plan: "enterprise" }
    })

    expect(created.plan).toBe("pro")
    expect(signedIn.plan).toBe("pro")
  })

  it("leaves the duplicate race to the unique constraint rather than resolving it itself", async () => {
    // Both calls read nothing and both insert. Core cannot prevent that without
    // a lock the contract does not have, so the constraint decides — a failed
    // request rather than two accounts for one person.
    const { internals, db } = await createTestInternals()

    const results = await Promise.allSettled([
      findOrCreateUser(internals, { identifier: ada }),
      findOrCreateUser(internals, { identifier: ada })
    ])

    expect(
      results.filter((result) => result.status === "rejected")
    ).not.toHaveLength(2)
    expect(await selectRows(db, "users", { email: ada.value })).toHaveLength(1)
  })

  it("keys on the phone number when that is what was proven", async () => {
    const { internals } = await createTestInternals()

    const user = await findOrCreateUser(internals, {
      identifier: { kind: "phoneNumber", value: "+15550100" }
    })

    expect(user.phoneNumber).toBe("+15550100")
    expect(user.email).toBeNull()
  })
})
