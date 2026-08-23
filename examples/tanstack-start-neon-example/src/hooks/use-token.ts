import { useQuery } from "@tanstack/react-query"
import { authClient } from "../lib/auth-client"

export const tokenQueryKey = ["token"] as const

export function useToken() {
  return useQuery({
    queryKey: tokenQueryKey,
    queryFn: authClient.getToken
  })
}
