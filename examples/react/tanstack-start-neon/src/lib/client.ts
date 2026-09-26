import { fetchWithToken, NeonPostgrestClient } from "@neondatabase/postgrest-js"
import type { Database } from "../types/database"
import { authClient } from "./auth-client"

export const client = new NeonPostgrestClient<Database>({
  dataApiUrl: import.meta.env.VITE_NEON_DATA_API_URL,
  options: {
    global: {
      fetch: fetchWithToken(authClient.getToken)
    }
  }
})
