import { useQuery } from "@supabase-cache-helpers/postgrest-react-query"

import { client } from "../lib/client"
import { useToken } from "./use-token"

export function useUser() {
  const { data: token } = useToken()

  const user = useQuery(client.from("users").select().single(), {
    enabled: !!token
  })

  return {
    data: token ? user.data : null,
    isPending: !token || user.isPending
  }
}
