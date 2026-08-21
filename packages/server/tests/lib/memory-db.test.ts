import { beforeEach, describe, expect, it } from "vitest"
import type { MemoryDb } from "../../src/lib/memory-db.ts"
import { createMemoryDb } from "../../src/lib/memory-db.ts"

let db: MemoryDb

beforeEach(() => {
  db = createMemoryDb()
})

describe("upsertUser", () => {
  it("creates on first sight of an identifier and merges afterwards", async () => {
    const created = await db.upsertUser({
      email: "ada@example.com",
      type: "user"
    })
    const merged = await db.upsertUser({
      email: "ada@example.com",
      name: "Ada"
    })

    expect(merged.id).toBe(created.id)
    expect(merged.name).toBe("Ada")
    expect(db.users()).toHaveLength(1)
  })

  it("leaves omitted fields alone", async () => {
    await db.upsertUser({
      email: "ada@example.com",
      name: "Ada",
      imageURL: "https://img.example/a.png"
    })
    const merged = await db.upsertUser({
      email: "ada@example.com",
      name: "Ada Lovelace"
    })

    expect(merged.imageURL).toBe("https://img.example/a.png")
  })

  it("applies type on insert only, so an admin is never demoted by signing in", async () => {
    // The consumer promotes out of band; core must not undo it on the next sign-in.
    const admin = await db.upsertUser({
      email: "admin@example.com",
      type: "admin"
    })
    expect(admin.type).toBe("admin")

    const afterSignIn = await db.upsertUser({
      email: "admin@example.com",
      type: "user"
    })
    expect(afterSignIn.type).toBe("admin")
  })

  it("lets the id-targeted form promote a guest to user, the one type change core makes", async () => {
    const guest = await db.upsertUser({ type: "guest" })
    const converted = await db.upsertUser({ id: guest.id, type: "user" })

    expect(converted.type).toBe("user")
  })

  it("always creates a new row when no identifier is given, which is guest creation", async () => {
    const first = await db.upsertUser({ type: "guest" })
    const second = await db.upsertUser({ type: "guest" })

    expect(first.id).not.toBe(second.id)
    expect(first.email).toBeNull()
    expect(first.type).toBe("guest")
    expect(db.users()).toHaveLength(2)
  })

  it("targets an exact row by id without an identifier lookup", async () => {
    const guest = await db.upsertUser({ type: "guest" })
    const converted = await db.upsertUser({
      id: guest.id,
      email: "ada@example.com",
      type: "user"
    })

    expect(converted.id).toBe(guest.id)
    expect(converted.type).toBe("user")
    expect(db.users()).toHaveLength(1)
  })

  it("stores declared additional fields flat on the row", async () => {
    const user = await db.upsertUser({
      email: "ada@example.com",
      additionalFields: { referralCode: "ABC" }
    })
    expect((user as { referralCode?: string }).referralCode).toBe("ABC")
  })
})

describe("getUser", () => {
  it("looks up by id, email, or phone number", async () => {
    const created = await db.upsertUser({
      email: "ada@example.com",
      phoneNumber: "+15551234567"
    })

    expect((await db.getUser({ id: created.id }))?.id).toBe(created.id)
    expect((await db.getUser({ email: "ada@example.com" }))?.id).toBe(
      created.id
    )
    expect((await db.getUser({ phoneNumber: "+15551234567" }))?.id).toBe(
      created.id
    )
    expect(await db.getUser({ email: "nobody@example.com" })).toBeNull()
  })
})

describe("sessions", () => {
  const session = (
    overrides: Partial<Parameters<MemoryDb["upsertSession"]>[0]> = {}
  ) => ({
    id: "session-1",
    userId: "user-1",
    tokenHash: "hash-1",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    expiresAt: new Date("2026-02-01T00:00:00Z"),
    ...overrides
  })

  it("round-trips by token hash", async () => {
    await db.upsertSession(session())
    expect((await db.getSession({ tokenHash: "hash-1" }))?.userId).toBe(
      "user-1"
    )
  })

  it("keeps createdAt fixed across refreshes while expiry slides", async () => {
    await db.upsertSession(session())
    await db.upsertSession(
      session({
        createdAt: new Date("2026-01-15T00:00:00Z"),
        expiresAt: new Date("2026-03-01T00:00:00Z")
      })
    )
    const stored = await db.getSession({ tokenHash: "hash-1" })

    expect(stored?.createdAt.toISOString()).toBe("2026-01-01T00:00:00.000Z")
    expect(stored?.expiresAt.toISOString()).toBe("2026-03-01T00:00:00.000Z")
  })

  it("enforces ownership inside the delete query", async () => {
    await db.upsertSession(session())
    await db.deleteSession({ id: "session-1", userId: "someone-else" })
    expect(await db.getSession({ tokenHash: "hash-1" })).not.toBeNull()

    await db.deleteSession({ id: "session-1", userId: "user-1" })
    expect(await db.getSession({ tokenHash: "hash-1" })).toBeNull()
  })

  it("spares the current session when deleting the others", async () => {
    await db.upsertSession(session())
    await db.upsertSession(session({ id: "session-2", tokenHash: "hash-2" }))
    await db.upsertSession(session({ id: "session-3", tokenHash: "hash-3" }))

    await db.deleteSessions({ userId: "user-1", exceptTokenHash: "hash-2" })
    const remaining = await db.listSessions({ userId: "user-1" })

    expect(remaining.map((entry) => entry.tokenHash)).toEqual(["hash-2"])
  })

  it("cascades session and connection removal when a user is deleted", async () => {
    const user = await db.upsertUser({ email: "ada@example.com" })
    await db.upsertSession(session({ userId: user.id }))
    await db.upsertConnection({
      userId: user.id,
      provider: "github",
      providerAccountId: "42"
    })

    await db.deleteUser({ id: user.id })

    expect(await db.getSession({ tokenHash: "hash-1" })).toBeNull()
    expect(await db.listConnections({ userId: user.id })).toEqual([])
  })
})

describe("magic codes", () => {
  it("keeps one live code per identifier, so a resend replaces the old one", async () => {
    const base = {
      identifier: "ada@example.com",
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
      purpose: "signIn" as const
    }
    await db.upsertMagicCode({ ...base, codeHash: "first" })
    await db.upsertMagicCode({ ...base, codeHash: "second" })

    expect(
      (await db.getMagicCode({ identifier: "ada@example.com" }))?.codeHash
    ).toBe("second")
  })
})

describe("deleteExpired", () => {
  it("removes only rows that are already past their expiry", async () => {
    const past = new Date(Date.now() - 60_000)
    const future = new Date(Date.now() + 60_000)

    await db.upsertMagicCode({
      identifier: "old@example.com",
      codeHash: "x",
      expiresAt: past,
      attempts: 0,
      purpose: "signIn"
    })
    await db.upsertMagicCode({
      identifier: "new@example.com",
      codeHash: "y",
      expiresAt: future,
      attempts: 0,
      purpose: "signIn"
    })
    await db.upsertSession({
      id: "s1",
      userId: "u1",
      tokenHash: "dead",
      createdAt: past,
      expiresAt: past
    })
    await db.upsertSession({
      id: "s2",
      userId: "u1",
      tokenHash: "live",
      createdAt: past,
      expiresAt: future
    })
    await db.upsertRateLimit({ key: "old", count: 3, resetAt: past })
    await db.upsertRateLimit({ key: "live", count: 3, resetAt: future })

    await db.deleteExpired({ before: new Date() })

    expect(await db.getMagicCode({ identifier: "old@example.com" })).toBeNull()
    expect(
      await db.getMagicCode({ identifier: "new@example.com" })
    ).not.toBeNull()
    expect(await db.getSession({ tokenHash: "dead" })).toBeNull()
    expect(await db.getSession({ tokenHash: "live" })).not.toBeNull()
    expect(await db.getRateLimit({ key: "old" })).toBeNull()
    expect(await db.getRateLimit({ key: "live" })).not.toBeNull()
  })
})

describe("connections", () => {
  it("keys on the provider account id, so an email change does not duplicate a user", async () => {
    await db.upsertConnection({
      userId: "user-1",
      provider: "github",
      providerAccountId: "42",
      email: "old@example.com"
    })
    await db.upsertConnection({
      userId: "user-1",
      provider: "github",
      providerAccountId: "42",
      email: "new@example.com"
    })

    const connection = await db.getConnection({
      provider: "github",
      providerAccountId: "42"
    })
    expect(connection?.email).toBe("new@example.com")
    expect(await db.listConnections({ userId: "user-1" })).toHaveLength(1)
  })

  it("unlinks only the requested user's provider", async () => {
    await db.upsertConnection({
      userId: "user-1",
      provider: "github",
      providerAccountId: "42"
    })
    await db.upsertConnection({
      userId: "user-2",
      provider: "github",
      providerAccountId: "43"
    })

    await db.deleteConnection({ userId: "user-1", provider: "github" })

    expect(await db.listConnections({ userId: "user-1" })).toEqual([])
    expect(await db.listConnections({ userId: "user-2" })).toHaveLength(1)
  })
})
