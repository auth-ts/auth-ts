import type {
  AdditionalFieldsSchema,
  AuthDB,
  AuthDirection,
  AuthRow,
  AuthSession,
  AuthTable,
  AuthUser
} from "../core/auth-db"
import { isAuthRange } from "../core/auth-db"

/** An in-memory {@link AuthDB} plus a few helpers for inspecting it in tests. */
export interface MemoryDb extends AuthDB {
  /** Every stored row of a table, in insertion order. */
  rows<T extends AuthTable>(table: T): AuthRow<AdditionalFieldsSchema, T>[]
  /** Every stored user, in insertion order. */
  users(): AuthUser[]
  /** Every stored session, in insertion order. */
  sessions(): AuthSession[]
  /** Empties every table. */
  reset(): void
}

/** A stored row, as loosely typed as the bare contract's open map. */
type StoredRow = Record<string, unknown> & { id: string }

/**
 * The columns that must be unique, per table.
 *
 * These are the constraints the contract asks your database for, enforced here
 * so the library's own suite runs against the same arbiter a real store gives
 * it: core reads before it inserts, and the unique index is what decides the
 * race between two callers who both read nothing. A store without them does not
 * fail a test — it creates two accounts for one person in production.
 */
const UNIQUE_COLUMNS: { [T in AuthTable]?: string[][] } = {
  users: [["email"], ["phoneNumber"]],
  sessions: [["tokenHash"]],
  identities: [["provider", "providerUserId"]]
}

/** Orders two column values, with nulls and undefined last in either direction. */
function compare(left: unknown, right: unknown) {
  if (left === right) return 0
  if (left === null || left === undefined) return 1
  if (right === null || right === undefined) return -1
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() - right.getTime()
  }
  if (typeof left === "number" && typeof right === "number") return left - right

  return String(left) < String(right) ? -1 : 1
}

/**
 * Creates a fully in-memory implementation of the database contract.
 *
 * This is public API, exported as `@auth-ts/server/testing`, on purpose: the
 * library's own suite runs against this exact object, so when you test your auth
 * flows against it you are testing against the same semantics the library
 * verifies itself with — not a simplified mock that agrees with your
 * assumptions. It is deliberately generic: five maps of rows, equality
 * matching, and the uniqueness the contract requires. Everything that used to
 * be easy to get wrong in an implementation now lives in core, tested once.
 */
export function createMemoryDb(): MemoryDb {
  const tables = new Map<AuthTable, Map<string, StoredRow>>()

  const tableOf = (table: AuthTable) => {
    let rows = tables.get(table)
    if (!rows) {
      rows = new Map()
      tables.set(table, rows)
    }
    return rows
  }

  const order = (stored: unknown, bound: unknown) =>
    stored instanceof Date && bound instanceof Date
      ? stored.getTime() - bound.getTime()
      : Number(stored) - Number(bound)

  const matches = (row: StoredRow, where: Record<string, unknown>) =>
    Object.entries(where).every(([column, value]) => {
      const stored = row[column]

      if (isAuthRange(value)) {
        if (value.lt !== undefined && order(stored, value.lt) >= 0) return false
        if (value.gt !== undefined && order(stored, value.gt) <= 0) return false
        return true
      }

      if (stored instanceof Date && value instanceof Date) {
        return stored.getTime() === value.getTime()
      }
      return stored === value
    })

  const find = (table: AuthTable, where: Record<string, unknown>) =>
    [...tableOf(table).values()].filter((row) => matches(row, where))

  /** Rejects an insert that would duplicate a value the contract requires to be unique. */
  const assertUnique = (table: AuthTable, row: StoredRow) => {
    for (const columns of UNIQUE_COLUMNS[table] ?? []) {
      const values = columns.map((column) => row[column])
      if (values.some((value) => value === null || value === undefined))
        continue

      const conflicting = [...tableOf(table).values()].some(
        (stored) =>
          stored.id !== row.id &&
          columns.every((column, index) => stored[column] === values[index])
      )
      if (conflicting) {
        throw new Error(
          `duplicate key value violates unique constraint on ${table}(${columns.join(", ")})`
        )
      }
    }
  }

  // Every function returns `as never`: these tables are `Record<string, unknown>`
  // rows, and a generic `AuthRow<S, T>` return position is a write target TypeScript
  // narrows to the intersection of all five row types, which nothing satisfies.
  // A real implementation asserts at the same boundary for the same reason.
  return {
    async select({ table, where, limit, orderBy }) {
      const [[column, direction] = ["id", "asc" as AuthDirection]] =
        Object.entries(orderBy) as [string, AuthDirection][]

      return find(table, where)
        .sort((left, right) => {
          const order = compare(left[column], right[column])
          return direction === "asc" ? order : -order
        })
        .slice(0, limit)
        .map((row) => ({ ...row })) as never
    },

    async insert({ table, values }) {
      const stored: StoredRow = {
        ...(values as Record<string, unknown>),
        id: (values as { id?: string }).id ?? crypto.randomUUID()
      }
      assertUnique(table, stored)
      tableOf(table).set(stored.id, stored)

      return { ...stored } as never
    },

    async update({ table, where, values }) {
      const defined = Object.entries(values).filter(
        ([, value]) => value !== undefined
      )
      // The same failure a query builder gives an empty `SET`, so a core
      // regression surfaces in the suite rather than in someone's production
      // database.
      if (defined.length === 0) {
        throw new Error(`update on ${table} was given no values to set`)
      }

      return find(table, where).map((row) => {
        const updated = { ...row, ...Object.fromEntries(defined) }
        assertUnique(table, updated)
        tableOf(table).set(row.id, updated)

        return { ...updated }
      }) as never
    },

    async delete({ table, where }) {
      const removed = find(table, where)
      for (const row of removed) tableOf(table).delete(row.id)

      // The one cascade the contract asks a real database for, honoured here so
      // `authDBChecks` runs against this store the way it runs against yours.
      if (table === "identities") {
        for (const identity of removed) {
          for (const secret of find("identitySecrets", {
            identityId: identity.id
          })) {
            tableOf("identitySecrets").delete(secret.id)
          }
        }
      }

      return removed.map((row) => ({ ...row })) as never
    },

    rows: (table) =>
      [...tableOf(table).values()].map((row) => ({ ...row })) as never,
    users: () =>
      [...tableOf("users").values()].map((row) => ({ ...row })) as never,
    sessions: () =>
      [...tableOf("sessions").values()].map((row) => ({ ...row })) as never,
    reset: () => tables.clear()
  }
}
