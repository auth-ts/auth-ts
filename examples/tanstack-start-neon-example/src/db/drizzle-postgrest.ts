import type { PostgrestClient } from "@supabase/postgrest-js"
import type { InferInsertModel, InferSelectModel } from "drizzle-orm"
import type { PgTable } from "drizzle-orm/pg-core"

/** Types a postgrest-js `Database` from a drizzle schema: every table, keyed by its SQL name. */
export type DrizzlePostgrest<Schema> = {
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

/** Types a postgrest-js client against a drizzle schema. */
export function createDrizzlePostgrest<Schema extends Record<string, unknown>>(
  schema: Schema,
  postgrestClient: PostgrestClient
) {
  return postgrestClient as PostgrestClient<DrizzlePostgrest<Schema>>
}
