// @noStaticSemanticInfo
import {
  type AuthDatabaseOperator,
  type AuthOrderBy,
  type AuthTable,
  type AuthWhere,
  defineAuthDatabase
} from "@auth-ts/core"
import {
  and,
  type Column,
  getColumns,
  operators,
  orderByOperators
} from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import {
  identities,
  identitySecrets,
  rateLimits,
  sessions,
  users,
  verifications
} from "./schema"

const db = drizzle(process.env.DATABASE_URL as string)

const tables = {
  users,
  sessions,
  verifications,
  rateLimits,
  identities,
  identitySecrets
}

const columnsOf = (table: AuthTable): Record<string, Column> =>
  getColumns(tables[table])

const buildWhere = (table: AuthTable, where: AuthWhere) =>
  and(
    ...Object.entries(where).flatMap(([name, condition]) =>
      Object.entries(condition).map(([operator, value]) =>
        operators[operator as AuthDatabaseOperator](
          columnsOf(table)[name],
          value
        )
      )
    )
  )

const buildOrderBy = (table: AuthTable, orderBy: AuthOrderBy) =>
  Object.entries(orderBy).map(([name, direction]) =>
    orderByOperators[direction](columnsOf(table)[name])
  )

export const authDatabase = defineAuthDatabase({
  select: ({ table, where, limit, orderBy }) =>
    db
      .select()
      .from(tables[table])
      .where(buildWhere(table, where))
      .orderBy(...buildOrderBy(table, orderBy))
      .limit(limit),
  insert: ({ table, values }) =>
    db
      .insert(tables[table])
      .values(values)
      .returning()
      .then((rows) => rows[0]),
  update: ({ table, where, values }) =>
    db
      .update(tables[table])
      .set(values)
      .where(buildWhere(table, where))
      .returning(),
  delete: ({ table, where }) =>
    db.delete(tables[table]).where(buildWhere(table, where)).returning()
})
