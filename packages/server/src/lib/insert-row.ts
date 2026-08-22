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
 * without an `id` and the store's own default fills it; `insert` hands back
 * what it wrote either way, so core reads the id rather than assuming it.
 */
export async function insertRow<T extends AuthTable>(
  internals: AuthServerInternals,
  table: T,
  values: AuthInsert<AdditionalFieldsSchema, T>
): Promise<AuthRow<AdditionalFieldsSchema, T>> {
  const id = await internals.config.generateId?.(table)

  const [row] = await internals.db.insert({
    table,
    values: id === undefined ? values : { ...values, id }
  })
  // The store wrote a row or it threw; an insert that reports neither is a
  // broken implementation, and saying so here beats a confusing failure at
  // whichever call site first reads a field off nothing.
  if (!row) throw new Error(`insert into ${table} returned no row`)

  return row
}
