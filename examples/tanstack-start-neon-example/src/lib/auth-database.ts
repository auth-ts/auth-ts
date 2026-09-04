import {
  type AuthDatabaseOperator,
  type AuthOrderBy,
  type AuthTable,
  type AuthWhere,
  defineAuthDatabase
} from "@auth-ts/core"
import { and, getColumns, operators, orderByOperators } from "drizzle-orm"
import type { AnyPgColumn, AnyPgTable } from "drizzle-orm/pg-core"

import { db } from "../db/db"
import {
  attempts,
  identities,
  identitySecrets,
  sessions,
  users,
  verifications
} from "../db/schema"

const authSchema = {
  users,
  sessions,
  verifications,
  attempts,
  identities,
  identitySecrets
} satisfies Record<AuthTable, AnyPgTable>

const buildWhere = (table: AuthTable, where: AuthWhere) => {
  const columns: Record<string, AnyPgColumn> = getColumns(authSchema[table])

  return and(
    ...Object.entries(where).flatMap(([name, condition]) =>
      Object.entries(condition).map(([operator, value]) =>
        operators[operator as AuthDatabaseOperator](columns[name], value)
      )
    )
  )
}

const buildOrderBy = (table: AuthTable, orderBy: AuthOrderBy) => {
  const columns: Record<string, AnyPgColumn> = getColumns(authSchema[table])

  return Object.entries(orderBy).map(([name, direction]) =>
    orderByOperators[direction](columns[name])
  )
}

export const authDatabase = defineAuthDatabase({
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
