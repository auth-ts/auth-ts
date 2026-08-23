import { describe, expect, it, vi } from "vitest"
import { deleteUser } from "../../src/user/delete-user"
import { createTestInternals } from "../helpers/create-test-internals"
import { insertUser, selectRows } from "../helpers/rows"

/** A user with one of everything core owns hanging off them. */
async function seed() {
  const context = await createTestInternals()
  const { db } = context
  const user = await insertUser(db, {
    email: "ada@example.com",
    phoneNumber: "+15550100"
  })

  await db.insert({
    table: "sessions",
    values: {
      userId: user.id,
      tokenHash: "hash",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      userAgent: null,
      ipAddress: null,
      updatedAt: new Date()
    }
  })
  await db.insert({
    table: "identities",
    values: {
      userId: user.id,
      provider: "github",
      providerUserId: "1",
      label: "ada@example.com",
      createdAt: new Date(),
      updatedAt: new Date()
    }
  })
  for (const identifier of ["ada@example.com", "+15550100"]) {
    await db.insert({
      table: "verificationCodes",
      values: {
        identifier,
        codeHash: `code-${identifier}`,
        expiresAt: new Date(Date.now() + 60_000),
        action: "signIn",
        createdAt: new Date(),
        updatedAt: new Date()
      }
    })
  }

  return { ...context, user }
}

describe("deleteUser", () => {
  it("removes the user and everything of theirs core owns", async () => {
    const { internals, db, user } = await seed()

    await deleteUser(internals, user)

    expect(db.users()).toEqual([])
    expect(await selectRows(db, "sessions")).toEqual([])
    expect(await selectRows(db, "identities")).toEqual([])
    expect(await selectRows(db, "verificationCodes")).toEqual([])
  })

  it("deletes the children itself, so no cascade is required of the store", async () => {
    const { internals, db, user } = await seed()
    const tables: string[] = []
    const original = db.delete.bind(db)
    db.delete = async (input) => {
      tables.push(input.table)
      return original(input)
    }

    await deleteUser(internals, user)

    // Sessions first: a failure part-way through then leaves an account with no
    // live token rather than a live token with no account.
    expect(tables[0]).toBe("sessions")
    expect(tables.at(-1)).toBe("users")
    expect(tables).toContain("identities")
    expect(tables).toContain("verificationCodes")
  })

  it("takes an outstanding code with it, for each identifier the user had", async () => {
    const { internals, db, user } = await seed()

    await deleteUser(internals, user)

    // A code left behind for a freed address would sign its next owner into an
    // account that no longer exists.
    expect(await selectRows(db, "verificationCodes")).toEqual([])
  })

  it("leaves other people's rows alone", async () => {
    const { internals, db, user } = await seed()
    const grace = await insertUser(db, { email: "grace@example.com" })
    await db.insert({
      table: "sessions",
      values: {
        userId: grace.id,
        tokenHash: "grace-hash",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        userAgent: null,
        ipAddress: null,
        updatedAt: new Date()
      }
    })

    await deleteUser(internals, user)

    expect(db.users().map((row) => row.id)).toEqual([grace.id])
    expect(await selectRows(db, "sessions")).toHaveLength(1)
  })

  it("does not need a verification-code delete when the user is a guest", async () => {
    const { internals, db } = await createTestInternals()
    const guest = await insertUser(db, { type: "guest" })
    const remove = vi.spyOn(db, "delete")

    await deleteUser(internals, guest)

    expect(
      remove.mock.calls.some(([input]) => input.table === "verificationCodes")
    ).toBe(false)
  })
})
