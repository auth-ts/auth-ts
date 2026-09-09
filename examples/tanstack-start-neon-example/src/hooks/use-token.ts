import { useQuery } from "@tanstack/react-query"
import { authClient } from "../lib/auth-client"

export function useToken() {
  return useQuery({
    queryKey: ["token"],
    queryFn: () => authClient.getToken()
  })
}
