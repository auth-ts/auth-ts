import { describe, expect, it } from "vitest"
import type { AuthDatabase } from "../../src/core/auth-database"
import { defineAuthDatabase } from "../../src/core/auth-database"
import { createMemoryDatabase } from "../../src/lib/memory-database"
import { authDatabaseChecks } from "../../src/testing"

/** Which checks a store fails, in the order they run. */
async function failures(db: AuthDatabase) {
  const failed: string[] = []
  for (const check of authDatabaseChecks) {
    await check.run(db).catch(() => failed.push(check.name))
  }
  return failed
}

/** The reference implementation, with one part of the contract broken. */
function broken(patch: Partial<AuthDatabase>): AuthDatabase {
  return { ...createMemoryDatabase(), ...patch }
}

describe("authDatabaseChecks", () => {
  // The reference implementation has to pass the checks it ships beside, or
  // they are measuring something other than the contract.
  for (const check of authDatabaseChecks) {
    it(`passes: ${check.name}`, () => check.run(createMemoryDatabase()))
  }

  it("catches null predicates that never match", async () => {
    const db = createMemoryDatabase()
    const failed = await failures(
      defineAuthDatabase({
        ...db,
        select: (input) =>
          input.table === "users" && input.where.primaryUserId?.eq === null
            ? Promise.resolve([])
            : db.select(input)
      })
    )

    expect(failed).toContain(
      "guest claims atomically match type and unassigned primaryUserId"
    )
  })

  it("catches updates that check conditions before a separate write", async () => {
    const db = createMemoryDatabase()
    const failed = await failures(
      defineAuthDatabase({
        ...db,
        update: async (input) => {
          if (
            input.table !== "users" ||
            input.where.primaryUserId?.eq !== null
          ) {
            return db.update(input)
          }
          const matches = await db.select({
            table: "users",
            where: input.where,
            limit: 100,
            orderBy: { id: "asc" }
          })
          const changed = await Promise.all(
            matches.map((row) =>
              db.update({
                table: "users",
                where: { id: { eq: row.id } },
                values: input.values
              })
            )
          )
          return changed.flat() as never
        }
      })
    )

    expect(failed).toContain(
      "guest claims atomically match type and unassigned primaryUserId"
    )
  })

  it("catches a delete that does not return what it removed", async () => {
    const db = createMemoryDatabase()
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
    const db = createMemoryDatabase()
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
    const db = createMemoryDatabase()
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
    const db = createMemoryDatabase()
    const failed = await failures(
      broken({
        delete: (input) => {
          const where = Object.fromEntries(
            Object.entries(input.where).filter(([, condition]) =>
              Object.hasOwn(condition, "eq")
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
