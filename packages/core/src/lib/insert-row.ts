import type {
  AdditionalFieldsSchema,
  AuthInsert,
  AuthRow,
  AuthTable
} from "../core/auth-db"
import type { AuthInternals } from "../core/auth-internals"

/**
 * Inserts one row, stamping its timestamps and minting its id when the server
 * was given a generator.
 *
 * Every insert core makes goes through here, so "who names the row" is decided
 * in one place rather than per table. Without `generateId` the row is written
 * without an `id` and the store's own default fills it; `insert` hands back
 * what it wrote either way, so core reads the id rather than assuming it.
 *
 * `createdAt` and `updatedAt` are core's to write, so a store needs no column
 * default for them — and a store that has one is overruled rather than
 * consulted, which is what makes the two columns mean the same thing whichever
 * database is underneath.
 */
export async function insertRow<T extends AuthTable>(
  internals: AuthInternals,
  table: T,
  values: Omit<AuthInsert<AdditionalFieldsSchema, T>, "createdAt" | "updatedAt">
): Promise<AuthRow<AdditionalFieldsSchema, T>> {
  const id = await internals.config.generateId?.(table)
  const now = new Date()
  const stamped = { ...values, createdAt: now, updatedAt: now }

  const row = await internals.db.insert({
    table,
    values: (id === undefined ? stamped : { ...stamped, id }) as AuthInsert<
      AdditionalFieldsSchema,
      T
    >
  })
  // The store wrote a row or it threw; an insert that reports neither is a
  // broken implementation, and saying so here beats a confusing failure at
  // whichever call site first reads a field off nothing.
  if (!row) throw new Error(`insert into ${table} returned no row`)

  return row
}
