import { useQuery } from "@tanstack/react-query"
import { authClient } from "../lib/auth-client"

/** The query key the session lives under, shared so other hooks can scope to it. */
export const sessionQueryKey = ["session"] as const

/**
 * The signed-in user, the session, and a token — or `null` when signed out.
 *
 * `getUser` always reads the server, so caching, refetching, and persistence
 * are decided here rather than inside the auth client. Anything that changes
 * who is signed in invalidates this key.
 */
export function useUser() {
  return useQuery({
    queryKey: sessionQueryKey,
    queryFn: authClient.getUser
  })
}
