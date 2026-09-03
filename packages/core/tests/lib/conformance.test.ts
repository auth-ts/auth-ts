import { describe, expect, it } from "vitest"
import type { AuthDB } from "../../src/core/auth-db"
import { createMemoryDb } from "../../src/lib/memory-db"
import { authDBChecks } from "../../src/testing"

/** Which checks a store fails, in the order they run. */
async function failures(db: AuthDB) {
  const failed: string[] = []
  for (const check of authDBChecks) {
    await check.run(db).catch(() => failed.push(check.name))
  }
  return failed
}

/** The reference implementation, with one part of the contract broken. */
function broken(patch: Partial<AuthDB>): AuthDB {
  return { ...createMemoryDb(), ...patch }
}

describe("authDBChecks", () => {
  // The reference implementation has to pass the checks it ships beside, or
  // they are measuring something other than the contract.
  for (const check of authDBChecks) {
    it(`passes: ${check.name}`, () => check.run(createMemoryDb()))
  }

  it("catches a delete that does not return what it removed", async () => {
    const db = createMemoryDb()
    const failed = await failures(
      broken({
        delete: async (input) => {
          await db.delete(input)
          return []
        }
      })
    )

    expect(failed).toContain(
      "delete returns what it removed, and nothing when it matched nothing"
    )
  })

  it("catches a where that matches on any column instead of all of them", async () => {
    const db = createMemoryDb()
    const failed = await failures(
      broken({
        select: (input) => {
          const [first] = Object.entries(input.where)
          const where = first ? { [first[0]]: first[1] } : {}
          return db.select({ ...input, where } as typeof input)
        }
      })
    )

    expect(failed).toContain(
      "select matches on every column given, and only on equality"
    )
  })

  it("catches a select that ignores limit", async () => {
    const db = createMemoryDb()
    const failed = await failures(
      broken({
        select: (input) => db.select({ ...input, limit: 100 })
      })
    )

    expect(failed).toContain(
      "select honours limit and both directions of orderBy"
    )
  })

  it("catches a delete that ignores a range and removes every match", async () => {
    const db = createMemoryDb()
    const failed = await failures(
      broken({
        delete: (input) => {
          const where = Object.fromEntries(
            Object.entries(input.where).filter(
              ([, value]) =>
                !value || typeof value !== "object" || value instanceof Date
            )
          )
          return db.delete({ ...input, where } as typeof input)
        }
      })
    )

    expect(failed).toContain(
      "delete honours a range, removing what has expired and keeping what has not"
    )
  })
})
