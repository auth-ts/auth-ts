import type {
  AuthDirection,
  AuthOrderBy,
  AuthRange,
  AuthTable,
  AuthWhere
} from "@auth-ts/server"
import { defineAuthDB } from "@auth-ts/server"
import { and, asc, desc, eq, getColumns, gt, is, lt } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { PgTable } from "drizzle-orm/pg-core"

import { db } from "../db/db"
import * as schema from "../db/schema"

const authTables = Object.fromEntries(
  Object.entries(schema).filter(([, value]) => is(value, PgTable))
) as Pick<typeof schema, AuthTable>

/** A range, per the contract: an object that is not a Date. */
const isRange = (value: unknown): value is AuthRange<Date> =>
  typeof value === "object" && value !== null && !(value instanceof Date)

const buildWhere = (table: AuthTable, where: AuthWhere) => {
  const columns: Record<string, AnyPgColumn> = getColumns(authTables[table])

  return and(
    ...Object.entries(where).flatMap(([name, value]) =>
      isRange(value)
        ? [
            value.lt === undefined ? undefined : lt(columns[name], value.lt),
            value.gt === undefined ? undefined : gt(columns[name], value.gt)
          ]
        : [eq(columns[name], value)]
    )
  )
}

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
    db
      .update(authTables[table])
      .set(values)
      .where(buildWhere(table, where))
      .returning(),
  delete: ({ table, where }) =>
    db.delete(authTables[table]).where(buildWhere(table, where)).returning()
})
