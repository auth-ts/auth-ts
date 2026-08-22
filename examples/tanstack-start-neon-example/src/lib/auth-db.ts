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
 */
const tables = { users, sessions, verificationCodes, attempts, connections }

/**
 * The columns of a table, by name.
 *
 * `where` and `orderBy` arrive as column names rather than as column objects,
 * because the library has no way to hold a reference to your schema. This is
 * the translation, and the only place a name from the contract meets a column
 * in this file.
 */
const columnsOf = (table: keyof typeof tables): Record<string, PgColumn> =>
  getColumns(tables[table])

/** Every column/value pair in a `where`, as one `AND` — the only filter the contract has. */
const matches = (table: keyof typeof tables, where: object) => {
  const columns = columnsOf(table)

  return and(
    ...Object.entries(where).map(([name, value]) => {
      const column = columns[name]
      // Only reachable if this schema is missing a column the library names,
      // which is worth saying out loud rather than turning into a confusing
      // SQL error.
      if (!column) throw new Error(`${table} has no ${name} column`)

      return eq(column, value)
    })
  )
}

export const authDB = defineAuthDB({
  async select({ table, where, limit, offset, orderBy }) {
    const [[name = "id", direction = "asc"] = []] = Object.entries(orderBy)
    const column = columnsOf(table)[name]
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
