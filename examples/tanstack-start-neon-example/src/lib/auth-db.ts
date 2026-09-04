import type { AuthOrderBy, AuthTable, AuthWhere } from "@auth-ts/core"
import { defineAuthDB } from "@auth-ts/core"
import { and, asc, desc, eq, getColumns, gt, is, lt } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { PgTable } from "drizzle-orm/pg-core"

import { db } from "../db/db"
import * as schema from "../db/schema"

const authTables = Object.fromEntries(
  Object.entries(schema).filter(([, value]) => is(value, PgTable))
) as Pick<typeof schema, AuthTable>

const buildWhere = (table: AuthTable, where: AuthWhere) => {
  const columns: Record<string, AnyPgColumn> = getColumns(authTables[table])

  return and(
    ...Object.entries(where).flatMap(([name, condition]) => [
      "eq" in condition ? eq(columns[name], condition.eq) : undefined,
      "lt" in condition ? lt(columns[name], condition.lt) : undefined,
      "gt" in condition ? gt(columns[name], condition.gt) : undefined
    ])
  )
}

const buildOrderBy = (table: AuthTable, orderBy: AuthOrderBy) => {
  const columns: Record<string, AnyPgColumn> = getColumns(authTables[table])

  return Object.entries(orderBy).map(([name, direction]) =>
    (direction === "asc" ? asc : desc)(columns[name])
  )
}

export const authDB = defineAuthDB({
  select: ({ table, where, limit, orderBy }) =>
    db
      .select()
      .from(authTables[table])
      .where(buildWhere(table, where))
      .orderBy(...buildOrderBy(table, orderBy))
      .limit(limit),
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
