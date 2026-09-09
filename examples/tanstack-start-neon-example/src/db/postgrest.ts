import { PostgrestClient } from "@supabase/postgrest-js"
import type { InferInsertModel, InferSelectModel } from "drizzle-orm"
import type { PgTable } from "drizzle-orm/pg-core"
import { authClient } from "../lib/auth-client"
import type * as schema from "./schema"

/** Types a postgrest-js `Database` from a drizzle schema: every table, keyed by its SQL name. */
type DrizzlePostgrest<Schema> = {
  public: {
    Tables: {
      [K in keyof Schema as Schema[K] extends PgTable
        ? Schema[K]["_"]["name"]
        : never]: Schema[K] extends PgTable
        ? {
            Row: InferSelectModel<Schema[K]>
            Insert: InferInsertModel<Schema[K]>
            Update: Partial<InferInsertModel<Schema[K]>>
            Relationships: []
          }
        : never
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

/** Revives JSON date strings into Dates. */
export function reviveDates<K extends string, Row extends Record<K, Date>>(
  row: Row,
  ...keys: K[]
): Row {
  const dates: Partial<Record<K, Date>> = {}
  for (const key of keys) dates[key] = new Date(row[key])
  return { ...row, ...dates }
}

/** The data plane: PostgREST over Neon, authenticated by our access token. */
export const postgrest = new PostgrestClient<DrizzlePostgrest<typeof schema>>(
  import.meta.env.VITE_NEON_DATA_API_URL as string,
  { fetch: authClient.fetchWithAuth }
)
