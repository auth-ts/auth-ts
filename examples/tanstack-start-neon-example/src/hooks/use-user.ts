import { skipToken, useQuery } from "@tanstack/react-query"

import { postgrest } from "../db/postgrest"
import { useToken } from "./use-token"

export const userQueryKey = ["user"] as const

export function useUser() {
  const { data: token } = useToken()

  return useQuery({
    queryKey: userQueryKey,
    queryFn: !token
      ? skipToken
      : async () =>
          postgrest
            .from("users")
            .select()
            .single()
            .throwOnError()
            .then(({ data }) => data)
  })
}
