import { describe, expect, it } from "vitest"
import { revokeOtherSessions } from "../../src/session/revoke-other-sessions"
import { createTestInternals } from "../helpers/create-test-internals"
import { insertUser, selectRows } from "../helpers/rows"

/** Seeds `count` sessions for one user and returns their token hashes. */
async function seedSessions(
  db: Awaited<ReturnType<typeof createTestInternals>>["db"],
  userId: string,
  count: number
) {
  const hashes: string[] = []
  for (let index = 0; index < count; index++) {
    const tokenHash = `hash-${index}`
    await db.insert({
      table: "sessions",
      values: {
        userId,
        tokenHash,
        createdAt: new Date(Date.now() + index),
        expiresAt: new Date(Date.now() + 60_000),
        userAgent: null,
        ipAddress: null
      }
    })
    hashes.push(tokenHash)
  }

  return hashes
}

describe("revokeOtherSessions", () => {
  it("revokes every session but the one making the request", async () => {
    const { internals, db } = await createTestInternals()
    const user = await insertUser(db, { email: "ada@example.com" })
    const [current] = await seedSessions(db, user.id, 4)

    const revoked = await revokeOtherSessions(
      internals,
      user.id,
      current as string
    )

    expect(revoked).toBe(3)
    const remaining = await selectRows(db, "sessions")
    expect(remaining.map((row) => row.tokenHash)).toEqual([current])
  })

  it("pages past the read ceiling, so a long device list is fully revoked", async () => {
    // "Everything but this one" is the single shape an equality `where` cannot
    // express, so core pages and deletes by id — and the page size is what it
    // has to get past here.
    const { internals, db } = await createTestInternals()
    const user = await insertUser(db, { email: "ada@example.com" })
    const [current] = await seedSessions(db, user.id, 150)

    const revoked = await revokeOtherSessions(
      internals,
      user.id,
      current as string
    )

    expect(revoked).toBe(149)
    expect(await selectRows(db, "sessions")).toHaveLength(1)
  })

  it("leaves other users signed in", async () => {
    const { internals, db } = await createTestInternals()
    const ada = await insertUser(db, { email: "ada@example.com" })
    const grace = await insertUser(db, { email: "grace@example.com" })
    await db.insert({
      table: "sessions",
      values: {
        userId: grace.id,
        tokenHash: "grace",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        userAgent: null,
        ipAddress: null
      }
    })
    const [current] = await seedSessions(db, ada.id, 2)

    await revokeOtherSessions(internals, ada.id, current as string)

    const remaining = await selectRows(db, "sessions")
    expect(remaining.map((row) => row.tokenHash).sort()).toEqual([
      "grace",
      current
    ])
  })

  it("stops and says so if a delete removes nothing it was just handed", async () => {
    const { internals, db, logCalls } = await createTestInternals()
    const user = await insertUser(db, { email: "ada@example.com" })
    const [current] = await seedSessions(db, user.id, 3)
    db.delete = async () => []

    const revoked = await revokeOtherSessions(
      internals,
      user.id,
      current as string
    )

    expect(revoked).toBe(0)
    expect(logCalls.some((call) => call.level === "error")).toBe(true)
  })
})
