import type {
  AuthDirection,
  AuthOrderBy,
  AuthTable,
  AuthWhere
} from "@auth-ts/server"
import { defineAuthDB } from "@auth-ts/server"
import { and, asc, desc, eq, getColumns, is, lt, sql } from "drizzle-orm"
import { PgTable } from "drizzle-orm/pg-core"

import { db } from "../db/db"
import * as schema from "../db/schema"

// `Pick` is checked against the schema's own keys, so a table the contract
// names but the schema lacks is a compile error rather than an undefined.
const authTables = Object.fromEntries(
  Object.entries(schema).filter(([, value]) => is(value, PgTable))
) as Pick<typeof schema, AuthTable>

// `Object.entries` widens keys to `string`, and a string index into `columns`
// is `| undefined`; naming the keys keeps every lookup below a real property.
// `keyof typeof columns` is narrower than the truth — `columns` is a union of
// every table's, so its `keyof` is their shared columns — and `never` is
// whatever `eq` will accept for a column it cannot pin down. Both are load
// bearing: `unknown` in either place does not compile.
const buildWhere = (table: AuthTable, where: AuthWhere) => {
  const columns = getColumns(authTables[table])
  const entries = Object.entries(where) as [keyof typeof columns, never][]

  return and(...entries.map(([name, value]) => eq(columns[name], value)))
}

// Same reading as `buildWhere`, and the direction is real here because
// `orderBy` carries one.
const buildOrderBy = (table: AuthTable, orderBy: AuthOrderBy) => {
  const columns = getColumns(authTables[table])
  const entries = Object.entries(orderBy) as [
    keyof typeof columns,
    AuthDirection
  ][]

  return entries.map(([name, direction]) =>
    (direction === "asc" ? asc : desc)(columns[name])
  )
}

export const authDB = defineAuthDB({
  select: ({ table, where, limit, offset, orderBy }) =>
    db
      .select()
      .from(authTables[table])
      .where(buildWhere(table, where))
      .orderBy(...buildOrderBy(table, orderBy))
      .limit(limit)
      .offset(offset),
  insert: ({ table, values }) =>
    db
      .insert(authTables[table])
      .values(values)
      .returning()
      .then((rows) => rows[0]),
  update: ({ table, where, values }) =>
    db.update(authTables[table]).set(values).where(buildWhere(table, where)),
  delete: ({ table, where }) =>
    db.delete(authTables[table]).where(buildWhere(table, where)).returning(),
  cleanup: () =>
    Promise.all(
      [
        authTables.sessions,
        authTables.verificationCodes,
        authTables.attempts
      ].map((table) => db.delete(table).where(lt(table.expiresAt, sql`now()`)))
    )
})
