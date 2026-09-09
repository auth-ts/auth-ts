import { PostgrestClient } from "@supabase/postgrest-js"
import { authClient } from "../lib/auth-client"
import { createDrizzlePostgrest } from "./drizzle-postgrest"
import * as schema from "./schema"

/** The data plane: PostgREST over Neon, authenticated by our access token. */
export const postgrest = createDrizzlePostgrest(
  schema,
  new PostgrestClient(import.meta.env.VITE_NEON_DATA_API_URL, {
    fetch: authClient.fetchWithAuth
  })
)
