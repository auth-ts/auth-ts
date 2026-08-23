import { useQuery, useQueryClient } from "@tanstack/react-query"
import { authClient } from "../lib/auth-client"
import { userQueryKey } from "./use-user"

export const tokenQueryKey = ["token"] as const

export function useToken() {
  const queryClient = useQueryClient()

  return useQuery({
    queryKey: tokenQueryKey,
    queryFn: () =>
      authClient.getToken({
        onRefresh: ({ user }) => queryClient.setQueryData(userQueryKey, user)
      })
  })
}
