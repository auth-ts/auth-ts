import { fetchWithToken, NeonPostgrestClient } from "@neondatabase/postgrest-js"

import { authClient } from "../lib/auth-client"
import type { Database } from "../types/database"

export const postgrest = new NeonPostgrestClient<Database>({
  dataApiUrl: import.meta.env.VITE_NEON_DATA_API_URL,
  options: {
    global: {
      fetch: fetchWithToken(authClient.getToken)
    }
  }
})
