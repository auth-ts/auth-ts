import {
  type AuthDatabaseOperator,
  type AuthOrderBy,
  type AuthTable,
  type AuthWhere,
  defineAuthDatabase
} from "@auth-ts/core"
import { and, getColumns, operators, orderByOperators } from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"

import { db } from "../db/db"
import * as schema from "../db/schema"

const authSchema = schema satisfies Record<AuthTable, AnyPgTable>

const buildWhere = (table: AuthTable, where: AuthWhere<"string">) => {
  const columns = getColumns(authSchema[table])
  type ColumnName = keyof typeof columns

  return and(
    ...Object.entries(where).flatMap(([name, condition]) =>
      Object.entries(condition).map(([operator, value]) =>
        operators[operator as AuthDatabaseOperator](
          columns[name as ColumnName],
          value
        )
      )
    )
  )
}

const buildOrderBy = (table: AuthTable, orderBy: AuthOrderBy) => {
  const columns = getColumns(authSchema[table])
  type ColumnName = keyof typeof columns

  return Object.entries(orderBy).map(([name, direction]) =>
    orderByOperators[direction](columns[name as ColumnName])
  )
}

export const authDatabase = defineAuthDatabase({
  timestamps: "string",
  select: ({ table, where, limit, orderBy }) =>
    db
      .select()
      .from(authSchema[table])
      .where(buildWhere(table, where))
      .orderBy(...buildOrderBy(table, orderBy))
      .limit(limit),
  insert: ({ table, values }) =>
    db
      .insert(authSchema[table])
      .values(values)
      .returning()
      .then((rows) => rows[0]),
  update: ({ table, where, values }) =>
    db
      .update(authSchema[table])
      .set(values)
      .where(buildWhere(table, where))
      .returning(),
  delete: ({ table, where }) =>
    db.delete(authSchema[table]).where(buildWhere(table, where)).returning()
})
