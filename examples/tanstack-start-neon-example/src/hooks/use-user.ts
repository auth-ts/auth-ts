import { AuthRequiredError } from "@neondatabase/postgrest-js"
import { useQuery } from "@supabase-cache-helpers/postgrest-react-query"

import { client } from "../lib/client"

export function useUser() {
  const { data, error, isPending } = useQuery(
    client.from("users").select().single()
  )

  return { data: error instanceof AuthRequiredError ? null : data, isPending }
}
