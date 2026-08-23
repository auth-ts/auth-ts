import { fetchWithToken, NeonPostgrestClient } from "@neondatabase/postgrest-js"
import type { InferInsertModel, InferSelectModel } from "drizzle-orm"
import type { PgTable } from "drizzle-orm/pg-core"

import type * as schema from "../db/schema"
import { authClient } from "./auth-client"

/** The PostgREST view of a drizzle schema: every table, keyed by its SQL name. */
type Tables<Schema> = {
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

type Database<Schema> = {
  public: {
    Tables: Tables<Schema>
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

const withToken = fetchWithToken(authClient.getToken)

/**
 * Retries a refused request once with a fresh token, and never more: if the
 * second attempt is also refused the session is genuinely gone.
 */
const withRetry: typeof fetch = async (input, init) => {
  const response = await withToken(input, init)
  if (response.status !== 401) return response

  authClient.clearToken()
  return withToken(input, init)
}

/** The data plane: PostgREST over Neon, authenticated by our access token. */
export const dataApi = new NeonPostgrestClient<Database<typeof schema>>({
  dataApiUrl: import.meta.env.VITE_NEON_DATA_API_URL as string,
  options: { global: { fetch: withRetry } }
})
