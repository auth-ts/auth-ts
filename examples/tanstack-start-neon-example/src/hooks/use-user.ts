import { skipToken, useQuery } from "@tanstack/react-query"

import { postgrest } from "../db/postgrest"
import { useToken } from "./use-token"

export const userQueryKey = ["user"] as const

export function useUser() {
  const { data: token, isPending: isTokenPending } = useToken()

  return useQuery({
    queryKey: userQueryKey,
    queryFn: isTokenPending
      ? skipToken
      : async () => {
          if (!token) return null

          const { data } = await postgrest
            .from("users")
            .select()
            .single()
            .throwOnError()

          return {
            ...data,
            createdAt: new Date(data.createdAt),
            updatedAt: new Date(data.updatedAt)
          }
        }
  })
}
