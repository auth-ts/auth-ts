import { useQuery } from "@supabase-cache-helpers/postgrest-react-query"

import { client } from "../lib/client"

export function useUser() {
  return useQuery(client.from("users").select().single())
}
