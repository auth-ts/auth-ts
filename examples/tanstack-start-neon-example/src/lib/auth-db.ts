import { defineAuthDB } from "@auth-ts/server"
import { and, asc, desc, eq, getColumns, lt, sql } from "drizzle-orm"
import type { PgColumn } from "drizzle-orm/pg-core"
import { db } from "../db/db"
import {
  attempts,
  connections,
  sessions,
  users,
  verificationCodes
} from "../db/schema"

/**
 * The whole database contract, written once against Drizzle rather than once
 * per table.
 *
 * The library names five tables and reads them by equality only, so a table
 * dictionary and a `where` built from `eq` covers every query it makes. If your
 * schema names things differently, this is where you map them — that mapping is
 * the entire cost of not having an adapter package.
 *
 * Keep the dictionary's own types: widening it to `AnyPgTable` erases each
 * table's row type along with it, and every function below would need a cast
 * back to the contract.
 */
const tables = { users, sessions, verificationCodes, attempts, connections }

/**
 * Every column/value pair in a `where`, as one `AND` — the only filter the
 * contract has.
 *
 * `where` arrives as column names rather than column objects, because the
 * library has no way to hold a reference to your schema. This is the
 * translation.
 */
const matches = (table: keyof typeof tables, where: object) => {
  const columns: Record<string, PgColumn> = getColumns(tables[table])

  return and(
    ...Object.entries(where).map(([name, value]) => {
      const column = columns[name]
      // Only reachable if this schema is missing a column the library names,
      // which is worth saying out loud rather than leaving to a confusing
      // failure further down.
      if (!column) throw new Error(`${table} has no ${name} column`)

      return eq(column, value)
    })
  )
}

export const authDB = defineAuthDB({
  async select({ table, where, limit, offset, orderBy }) {
    const columns: Record<string, PgColumn> = getColumns(tables[table])
    const [[name = "id", direction = "asc"] = []] = Object.entries(orderBy)
    const column = columns[name]
    if (!column) throw new Error(`${table} has no ${name} column`)

    return db
      .select()
      .from(tables[table])
      .where(matches(table, where))
      .orderBy((direction === "asc" ? asc : desc)(column))
      .limit(limit)
      .offset(offset)
  },

  async insert({ table, values }) {
    // The row comes back as stored, which is how the library learns the id this
    // schema's `uuidv7()` default just generated.
    const [inserted] = await db.insert(tables[table]).values(values).returning()
    if (!inserted) throw new Error(`insert into ${table} returned no row`)

    return inserted
  },

  async update({ table, where, values }) {
    await db.update(tables[table]).set(values).where(matches(table, where))
  },

  async delete({ table, where }) {
    return db.delete(tables[table]).where(matches(table, where)).returning()
  },

  async cleanup() {
    // Optional on the contract. Implementing it hands the sweep to the library,
    // which runs it at most once a minute after a mutating request; leaving it
    // out would mean owning the schedule here instead.
    await Promise.all(
      [sessions, verificationCodes, attempts].map((table) =>
        db.delete(table).where(lt(table.expiresAt, sql`now()`))
      )
    )
  }
})
