import type { AuthDirection, AuthTable } from "@auth-ts/server"
import { defineAuthDB } from "@auth-ts/server"
import { and, asc, desc, eq, getColumns, is, lt, sql } from "drizzle-orm"
import { PgTable } from "drizzle-orm/pg-core"
import { db } from "../db/db"
import * as schema from "../db/schema"

/**
 * The five tables the contract names, keyed by the name it uses.
 *
 * The schema module is already that dictionary, so there is no second list of
 * table names to drift from it. The filter keeps tables and nothing else, so
 * the schema is free to export a helper or a relation alongside them.
 */
const tables = Object.fromEntries(
  Object.entries(schema).filter(([, value]) => is(value, PgTable))
) as Pick<typeof schema, AuthTable>

/**
 * `Object.entries` types its keys as `string`, which is the one thing here that
 * is not true: `where` and `orderBy` are keyed by column name. Saying so gives
 * the lookups below real properties to find rather than an index that might
 * miss, which is why nothing in this file has to assert a column exists.
 *
 * The value is `never` because `eq` takes whatever the column on its left
 * holds, and the column is a union of five tables' worth — so the type it will
 * accept is the intersection of theirs. The value came out of that row to
 * begin with.
 */
type Columns = ReturnType<typeof getColumns<(typeof tables)[AuthTable]>>
type Filters = [keyof Columns, never][]
type Ordering = [keyof Columns, AuthDirection][]

export const authDB = defineAuthDB({
  async select({ table, where, limit, offset, orderBy }) {
    const columns = getColumns(tables[table])

    return db
      .select()
      .from(tables[table])
      .where(
        and(
          ...(Object.entries(where) as Filters).map(([name, value]) =>
            eq(columns[name], value)
          )
        )
      )
      .orderBy(
        ...(Object.entries(orderBy) as Ordering).map(([name, direction]) =>
          (direction === "asc" ? asc : desc)(columns[name])
        )
      )
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
    const columns = getColumns(tables[table])

    await db
      .update(tables[table])
      .set(values)
      .where(
        and(
          ...(Object.entries(where) as Filters).map(([name, value]) =>
            eq(columns[name], value)
          )
        )
      )
  },

  async delete({ table, where }) {
    const columns = getColumns(tables[table])

    return db
      .delete(tables[table])
      .where(
        and(
          ...(Object.entries(where) as Filters).map(([name, value]) =>
            eq(columns[name], value)
          )
        )
      )
      .returning()
  },

  async cleanup() {
    // Optional on the contract. Implementing it hands the sweep to the library,
    // which runs it at most once a minute after a mutating request; leaving it
    // out would mean owning the schedule here instead.
    await Promise.all(
      [tables.sessions, tables.verificationCodes, tables.attempts].map(
        (table) => db.delete(table).where(lt(table.expiresAt, sql`now()`))
      )
    )
  }
})
