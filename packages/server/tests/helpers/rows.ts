import type {
  AdditionalFieldsSchema,
  AuthRow,
  AuthTable,
  AuthUser,
  AuthWhere
} from "../../src/core/auth-db"
import type { MemoryDb } from "../../src/lib/memory-db"

/** Seeds a user, filling the columns core always writes so tests name only what they care about. */
export function insertUser(
  db: MemoryDb,
  fields: Partial<AuthUser> = {}
): Promise<AuthUser> {
  return db.insert({
    table: "users",
    values: {
      email: null,
      phoneNumber: null,
      name: null,
      imageURL: null,
      primaryUserId: null,
      type: "user",
      ...fields
    }
  })
}

/** Reads matching rows, unbounded enough for a test and ordered by insertion. */
export function selectRows<T extends AuthTable>(
  db: MemoryDb,
  table: T,
  where: AuthWhere<AdditionalFieldsSchema, T> = {}
): Promise<AuthRow<AdditionalFieldsSchema, T>[]> {
  return db.select({
    table,
    where,
    limit: 1000,
    offset: 0,
    orderBy: { id: "asc" } as never
  })
}

/** Reads the first matching row, or `null`. */
export async function selectRow<T extends AuthTable>(
  db: MemoryDb,
  table: T,
  where: AuthWhere<AdditionalFieldsSchema, T> = {}
): Promise<AuthRow<AdditionalFieldsSchema, T> | null> {
  const [row] = await selectRows(db, table, where)
  return row ?? null
}
