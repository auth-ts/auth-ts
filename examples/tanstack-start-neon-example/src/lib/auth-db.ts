import type { AuthDB, AuthTable } from "@auth-ts/server"
import { and, asc, desc, eq, getColumns, lt, sql } from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"
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
const tables = {
  users,
  sessions,
  verificationCodes,
  attempts,
  connections
} satisfies Record<AuthTable, AnyPgTable>

/**
 * Widening to `AnyPgTable` is what makes the generic version compile: Drizzle
 * cannot resolve `tables[table]` while `table` is still a type parameter, and
 * every query below is the same query whatever the row shape is.
 */
const tableOf = (table: AuthTable): AnyPgTable => tables[table]

const columnOf = (table: AuthTable, name: string) => {
  const column = getColumns(tableOf(table))[name]
  // Only reachable if this schema is missing a column the library names, which
  // is worth saying out loud rather than turning into a confusing SQL error.
  if (!column) throw new Error(`${table} has no ${name} column`)

  return column
}

const matches = (table: AuthTable, where: object) =>
  and(
    ...Object.entries(where).map(([name, value]) =>
      eq(columnOf(table, name), value)
    )
  )

export const authDB: AuthDB = {
  select: (async ({ table, where, limit, offset, orderBy }) => {
    if (table === "users") {
      return db
        .select()
        .from(users)
        .where(matches("users", where))
        .orderBy(asc(users.id))
        .limit(limit)
        .offset(offset)
    }

    const [[name, direction] = ["id", "asc"]] = Object.entries(orderBy)
    const order = direction === "asc" ? asc : desc

    return db
      .select()
      .from(tableOf(table))
      .where(matches(table, where))
      .orderBy(order(columnOf(table, name)))
      .limit(limit)
      .offset(offset)
  }) as AuthDB["select"],

  insert: (async ({ table, values }) => {
    // The row comes back as stored, which is how the library learns the id this
    // schema's `uuidv7()` default just generated.
    const [inserted] = await db
      .insert(tableOf(table))
      .values(values)
      .returning()
    if (!inserted) throw new Error(`insert into ${table} returned no row`)

    return inserted
  }) as AuthDB["insert"],

  async update({ table, where, values }) {
    await db.update(tableOf(table)).set(values).where(matches(table, where))
  },

  delete: (async ({ table, where }) =>
    db
      .delete(tableOf(table))
      .where(matches(table, where))
      .returning()) as AuthDB["delete"],

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
}
