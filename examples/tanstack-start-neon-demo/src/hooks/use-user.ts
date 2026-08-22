import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { authClient } from "../auth-client.ts"

/** The query key the session lives under, shared so other hooks can scope to it. */
export const sessionQueryKey = ["session"] as const

/**
 * The signed-in user, kept in step with the auth client.
 *
 * The subscribe bridge is not optional. Without it the store and React Query
 * become two sources of truth: signing out, verifying a code, or a sign-out in
 * another tab would update the store while the query kept serving its stale
 * cache.
 *
 * `getUser` costs nothing while the access token is valid, so refetching on
 * window focus is cheap — it becomes a real request only once the token is old
 * enough to need renewing anyway.
 */
export function useUser() {
  const queryClient = useQueryClient()

  useEffect(
    () =>
      authClient.subscribe((user) =>
        queryClient.setQueryData(sessionQueryKey, user)
      ),
    [queryClient]
  )

  return useQuery({
    queryKey: sessionQueryKey,
    queryFn: authClient.getUser
  })
}
