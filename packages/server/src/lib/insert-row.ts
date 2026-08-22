import type {
  AdditionalFieldsSchema,
  AuthInsert,
  AuthRow,
  AuthTable
} from "../core/auth-db"
import type { AuthServerInternals } from "../core/auth-server-internals"

/**
 * Inserts one row, minting its id first when the server was given a generator.
 *
 * Every insert core makes goes through here, so "who names the row" is decided
 * in one place rather than per table. Without `generateId` the row is written
 * without an `id` and the store's own default fills it; `insert` returns the
 * stored row either way, so core reads the id back rather than assuming it.
 */
export async function insertRow<T extends AuthTable>(
  internals: AuthServerInternals,
  table: T,
  values: AuthInsert<AdditionalFieldsSchema, T>
): Promise<AuthRow<AdditionalFieldsSchema, T>> {
  const id = await internals.config.generateId?.(table)

  return internals.db.insert({
    table,
    values: id === undefined ? values : { ...values, id }
  })
}
