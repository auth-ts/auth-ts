import { beforeEach, describe, expect, it } from "vitest"
import type { MemoryDatabase } from "../../src/lib/memory-database"
import { createMemoryDatabase } from "../../src/lib/memory-database"
import { required } from "../helpers/required"

let db: MemoryDatabase

beforeEach(() => {
  db = createMemoryDatabase()
})

const user = async (fields: Record<string, unknown> = {}) => {
  const row = await db.insert({
    table: "users",
    values: {
      email: null,
      phoneNumber: null,
      name: null,
      image: null,
      primaryUserId: null,
      type: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      ...fields
    }
  })

  return required(row, "inserted user")
}

const attempt = (key: string, expiresAt = new Date(Date.now() + 60_000)) =>
  db.insert({
    table: "attempts",
    values: { key, expiresAt, createdAt: new Date(), updatedAt: new Date() }
  })

const read = <T extends "users" | "sessions" | "verifications" | "attempts">(
  table: T,
  where: Record<string, unknown> = {},
  limit = 100
) =>
  db.select({
    table,
    where: where as never,
    limit,
    orderBy: { id: "asc" } as never
  })

describe("insert", () => {
  it("returns the stored row and names it when the caller did not", async () => {
    const created = await user({ email: "ada@example.com" })

    expect(created.id).toEqual(expect.any(String))
    expect(created.email).toBe("ada@example.com")
    expect(db.users()).toHaveLength(1)
  })

  it("keeps an id the caller supplied, which is what generateId produces", async () => {
    const created = await user({ id: "user_ada", email: "ada@example.com" })

    expect(created.id).toBe("user_ada")
    expect(await read("users", { id: { eq: "user_ada" } })).toHaveLength(1)
  })

  it("refuses a duplicate email, the constraint the contract requires", async () => {
    await user({ email: "ada@example.com" })

    // Core reads before it inserts, so this constraint — not core — is what
    // decides the race between two first sign-ins for one address.
    await expect(user({ email: "ada@example.com" })).rejects.toThrow(
      /unique constraint/
    )
  })

  it("refuses a duplicate provider identity", async () => {
    const owner = await user({ email: "ada@example.com" })
    const link = {
      userId: owner.id,
      provider: "github",
      providerUserId: "1",
      label: null,
      createdAt: new Date(),
      updatedAt: new Date()
    }
    await db.insert({ table: "identities", values: link })

    await expect(
      db.insert({ table: "identities", values: link })
    ).rejects.toThrow(/unique constraint/)
  })

  it("lets many rows share a null identifier, because guests have none", async () => {
    await user({ type: "guest" })
    await user({ type: "guest" })

    expect(db.users()).toHaveLength(2)
  })

  it("lets many attempts share a key, which is the whole point of the log", async () => {
    await attempt("sendCode:id:ada@example.com:0")
    await attempt("sendCode:id:ada@example.com:0")

    expect(
      await read("attempts", { key: { eq: "sendCode:id:ada@example.com:0" } })
    ).toHaveLength(2)
  })
})

describe("select", () => {
  beforeEach(async () => {
    await user({ email: "ada@example.com", name: "Ada", type: "admin" })
    await user({ email: "grace@example.com", name: "Grace" })
    await user({ email: "alan@example.com", name: "Alan" })
  })

  it("matches on every column given, and only on equality", async () => {
    expect(
      await read("users", { name: { eq: "Ada" }, type: { eq: "admin" } })
    ).toHaveLength(1)
    expect(
      await read("users", { name: { eq: "Ada" }, type: { eq: "user" } })
    ).toHaveLength(0)
  })

  it("returns every row when the query is empty", async () => {
    expect(await read("users")).toHaveLength(3)
  })

  it("caps the result at the limit", async () => {
    expect(await read("users", {}, 2)).toHaveLength(2)
  })

  it("orders by the named column in both directions", async () => {
    const ascending = await db.select({
      table: "users",
      where: {},
      limit: 10,
      orderBy: { name: "asc" }
    })
    const descending = await db.select({
      table: "users",
      where: {},
      limit: 10,
      orderBy: { name: "desc" }
    })

    expect(ascending.map((row) => row.name)).toEqual(["Ada", "Alan", "Grace"])
    expect(descending.map((row) => row.name)).toEqual(["Grace", "Alan", "Ada"])
  })

  it("orders dates chronologically rather than as strings", async () => {
    const identifier = "ada@example.com"
    const older = new Date("2026-01-01T00:00:00Z")
    const newer = new Date("2026-06-01T00:00:00Z")
    await db.insert({
      table: "verifications",
      values: {
        identifier,
        codeHash: "old",
        expiresAt: older,
        purpose: "signIn",
        createdAt: new Date(),
        updatedAt: new Date()
      }
    })
    await db.insert({
      table: "verifications",
      values: {
        identifier,
        codeHash: "new",
        expiresAt: newer,
        purpose: "signIn",
        createdAt: new Date(),
        updatedAt: new Date()
      }
    })

    const [newest] = await db.select({
      table: "verifications",
      where: { identifier: { eq: identifier } },
      limit: 1,
      orderBy: { expiresAt: "desc" }
    })

    expect(newest?.codeHash).toBe("new")
  })

  it("hands back copies, so a caller cannot edit the table by mutating a row", async () => {
    const [row] = await read("users", { email: { eq: "ada@example.com" } })
    if (row) row.name = "mutated"

    const [stored] = await read("users", { email: { eq: "ada@example.com" } })
    expect(stored?.name).toBe("Ada")
  })
})

describe("update", () => {
  it("applies the given fields to every match and leaves the rest alone", async () => {
    const ada = await user({ email: "ada@example.com", name: "Ada" })

    await db.update({
      table: "users",
      where: { id: { eq: ada.id } },
      values: { name: "Ada Lovelace" }
    })

    const [stored] = await read("users", { id: { eq: ada.id } })
    expect(stored?.name).toBe("Ada Lovelace")
    expect(stored?.email).toBe("ada@example.com")
  })

  it("refuses a set with nothing defined in it, as a query builder would", async () => {
    const ada = await user({ email: "ada@example.com" })

    // Core strips undefined and skips the call when nothing is left, so this
    // failing here is how a regression in that rule surfaces in the suite
    // rather than in someone's database.
    await expect(
      db.update({
        table: "users",
        where: { id: { eq: ada.id } },
        values: { name: undefined }
      })
    ).rejects.toThrow(/no values to set/)
  })

  it("refuses an update that would duplicate a unique value", async () => {
    await user({ email: "ada@example.com" })
    const grace = await user({ email: "grace@example.com" })

    await expect(
      db.update({
        table: "users",
        where: { id: { eq: grace.id } },
        values: { email: "ada@example.com" }
      })
    ).rejects.toThrow(/unique constraint/)
  })
})

describe("delete", () => {
  it("returns what it removed, which is how core answers 404 rather than 204", async () => {
    const ada = await user({ email: "ada@example.com" })

    const removed = await db.delete({
      table: "users",
      where: { id: { eq: ada.id } }
    })
    const missed = await db.delete({
      table: "users",
      where: { id: { eq: ada.id } }
    })

    expect(removed.map((row) => row.id)).toEqual([ada.id])
    expect(missed).toEqual([])
    expect(db.users()).toEqual([])
  })

  it("removes every match, not just the first", async () => {
    await attempt("burst")
    await attempt("burst")
    await attempt("other")

    const removed = await db.delete({
      table: "attempts",
      where: { key: { eq: "burst" } }
    })

    expect(removed).toHaveLength(2)
    expect(await read("attempts")).toHaveLength(1)
  })

  it("matches on every column, so an id that belongs to someone else matches nothing", async () => {
    const ada = await user({ email: "ada@example.com" })
    const grace = await user({ email: "grace@example.com" })
    const session = await db.insert({
      table: "sessions",
      values: {
        userId: ada.id,
        tokenHash: "hash",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        userAgent: null,
        ipAddress: null,
        updatedAt: new Date()
      }
    })

    const stolen = await db.delete({
      table: "sessions",
      where: {
        id: { eq: required(session, "inserted session").id },
        userId: { eq: grace.id }
      }
    })

    expect(stolen).toEqual([])
    expect(await read("sessions")).toHaveLength(1)
  })
})

describe("reset", () => {
  it("empties every table", async () => {
    await user({ email: "ada@example.com" })
    await attempt("key")

    db.reset()

    expect(db.users()).toEqual([])
    expect(await read("attempts")).toEqual([])
  })
})
