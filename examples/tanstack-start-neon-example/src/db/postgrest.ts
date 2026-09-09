import { PostgrestClient } from "@supabase/postgrest-js"
import { authClient } from "../lib/auth-client"
import { createDrizzlePostgrest } from "./drizzle-postgrest"
import * as schema from "./schema"

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
export const postgrest = createDrizzlePostgrest(
  schema,
  new PostgrestClient(import.meta.env.VITE_NEON_DATA_API_URL, {
    fetch: authClient.fetchWithAuth
  })
)
