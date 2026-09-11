import { describe, expect, it } from "vitest"
import type { AuthRow } from "../../src/core/auth-database"
import { defineAuthDatabase } from "../../src/core/auth-database"

type StoredSession = AuthRow<"string", Record<string, never>, "sessions">

const storedSession: StoredSession = {
  id: "session-1",
  userId: "user-1",
  tokenHash: "hash",
  expiresAt: "2030-01-01T00:00:00.000Z",
  userAgent: null,
  ipAddress: null,
  amr: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
}

describe("defineAuthDatabase with string timestamps", () => {
  it("hands the store ISO strings inside conditions and values", async () => {
    const seen: Record<string, unknown>[] = []
    const db = defineAuthDatabase({
      timestamps: "string",
      select: async (input) => {
        seen.push(input)
        return [storedSession]
      },
      insert: async (input) => {
        seen.push(input)
        return { ...storedSession, ...input.values }
      },
      update: async () => [],
      delete: async () => []
    })

    const [selected] = await db.select({
      table: "sessions",
      where: { expiresAt: { gt: new Date(0) } },
      limit: 1,
      orderBy: { id: "asc" }
    })
    const inserted = await db.insert({
      table: "sessions",
      values: {
        userId: "user-1",
        tokenHash: "hash",
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
        userAgent: null,
        ipAddress: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z")
      }
    })

    expect(seen[0]?.where).toEqual({
      expiresAt: { gt: "1970-01-01T00:00:00.000Z" }
    })
    expect(seen[1]?.values).toMatchObject({
      createdAt: "2026-01-01T00:00:00.000Z"
    })
    expect(selected?.expiresAt).toBeInstanceOf(Date)
    expect(inserted?.createdAt).toBeInstanceOf(Date)
  })
})
