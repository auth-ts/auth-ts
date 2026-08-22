import type {
  AdditionalFieldsSchema,
  AuthOrderBy,
  AuthRow,
  AuthTable,
  AuthWhere
} from "../core/auth-db"
import type { AuthServerInternals } from "../core/auth-server-internals"

/**
 * Reads at most one row.
 *
 * Most of core's reads are a single row by a unique column, where the ordering
 * is immaterial and only the ceiling matters. This spells the ceiling — and the
 * `offset` and `orderBy` the contract requires — once, so a call site says what
 * it is looking for and nothing else. Pass `orderBy` where the *choice* of row
 * matters, as the newest verification code does.
 */
export async function selectOne<T extends AuthTable>(
  internals: AuthServerInternals,
  table: T,
  where: AuthWhere<AdditionalFieldsSchema, T>,
  orderBy?: AuthOrderBy<AdditionalFieldsSchema, T>
): Promise<AuthRow<AdditionalFieldsSchema, T> | null> {
  const [row] = await internals.db.select({
    table,
    where,
    limit: 1,
    offset: 0,
    // Every table has an `id`, so this is valid for each of them — but not
    // provably so while `T` is still a type parameter, which is what the
    // assertion says.
    orderBy:
      orderBy ?? ({ id: "asc" } as AuthOrderBy<AdditionalFieldsSchema, T>)
  })

  return row ?? null
}
