import { describe, expect, it, vi } from "vitest"
import { findOrCreateUser } from "../../src/user/find-or-create-user"
import { createTestInternals } from "../helpers/create-test-internals"
import { insertUser, selectRows } from "../helpers/rows"

const ada = { kind: "email", value: "ada@example.com" } as const

describe("findOrCreateUser", () => {
  it("creates the user on a first sign-in, with the columns core owns spelled out", async () => {
    const { internals, db } = await createTestInternals()

    const { user, created } = await findOrCreateUser(internals, {
      identifier: ada
    })

    expect(created).toBe(true)
    expect(user.email).toBe("ada@example.com")
    expect(user.type).toBe("user")
    expect(user.phoneNumber).toBeNull()
    expect(db.users()).toHaveLength(1)
  })

  it("returns the same user on the next sign-in rather than creating a second", async () => {
    const { internals, db } = await createTestInternals()

    const first = await findOrCreateUser(internals, { identifier: ada })
    const second = await findOrCreateUser(internals, { identifier: ada })

    expect(second.created).toBe(false)
    expect(second.user.id).toBe(first.user.id)
    expect(db.users()).toHaveLength(1)
  })

  it("writes nothing when the sign-in carries no profile fields", async () => {
    // Most query builders refuse an empty update.
    const { internals, db } = await createTestInternals()
    await findOrCreateUser(internals, { identifier: ada })
    const update = vi.spyOn(db, "update")

    await findOrCreateUser(internals, { identifier: ada })

    expect(update).not.toHaveBeenCalled()
  })

  it("moves name and image on a returning sign-in when the provider sent them", async () => {
    const { internals } = await createTestInternals()
    await findOrCreateUser(internals, { identifier: ada, name: "Ada" })

    const { user: updated } = await findOrCreateUser(internals, {
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

    const { user: signedIn } = await findOrCreateUser(internals, {
      identifier: { kind: "email", value: "admin@example.com" }
    })

    expect(signedIn.type).toBe("admin")
  })

  it("applies declared fields on create only, so a sign-in body cannot rewrite them", async () => {
    const { internals } = await createTestInternals({
      user: { additionalFields: { plan: "string" } }
    })

    const { user: created } = await findOrCreateUser(internals, {
      identifier: ada,
      additionalFields: { plan: "pro" }
    })
    const { user: signedIn } = await findOrCreateUser(internals, {
      identifier: ada,
      additionalFields: { plan: "enterprise" }
    })

    expect(created.plan).toBe("pro")
    expect(signedIn.plan).toBe("pro")
  })

  it("settles two first sign-ins on one user: the constraint refuses one, which reads the winner", async () => {
    const { internals, db } = await createTestInternals()

    const [first, second] = await Promise.all([
      findOrCreateUser(internals, { identifier: ada }),
      findOrCreateUser(internals, { identifier: ada })
    ])

    expect(first.user.id).toBe(second.user.id)
    expect([first.created, second.created].sort()).toEqual([false, true])
    expect(
      await selectRows(db, "users", { email: { eq: ada.value } })
    ).toHaveLength(1)
  })

  it("keys on the phone number when that is what was proven", async () => {
    const { internals } = await createTestInternals()

    const { user } = await findOrCreateUser(internals, {
      identifier: { kind: "phoneNumber", value: "+15550100" }
    })

    expect(user.phoneNumber).toBe("+15550100")
    expect(user.email).toBeNull()
  })
})
