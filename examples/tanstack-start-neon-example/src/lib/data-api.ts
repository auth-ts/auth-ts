import { fetchWithToken, NeonPostgrestClient } from "@neondatabase/postgrest-js"
import type { Todo, todos } from "../db/schema"
import { authClient } from "./auth-client"

/** The tables the browser reaches through the Data API, typed from the schema. */
interface Database {
  public: {
    Tables: {
      todos: {
        Row: Todo
        Insert: typeof todos.$inferInsert
        Update: Partial<typeof todos.$inferInsert>
        Relationships: []
      }
    }
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
export const dataApi = new NeonPostgrestClient<Database>({
  dataApiUrl: import.meta.env.VITE_NEON_DATA_API_URL ?? "",
  options: { global: { fetch: withRetry } }
})
