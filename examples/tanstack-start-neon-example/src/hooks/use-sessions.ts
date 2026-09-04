import { skipToken, useQuery } from "@tanstack/react-query"

import { postgrest, reviveDates } from "../db/postgrest"

/** The query key a user's sessions live under, shared so revoking can invalidate it. */
export const sessionsQueryKey = (userId?: string) => ["sessions", userId]

/** Every session on this account, newest first. */
export function useSessions(userId?: string) {
  return useQuery({
    queryKey: sessionsQueryKey(userId),
    queryFn: userId
      ? async () => {
          const { data } = await postgrest
            .from("sessions")
            .select()
            .order("createdAt", { ascending: false })
            .throwOnError()

          return data.map((session) =>
            reviveDates(session, "expiresAt", "createdAt", "updatedAt")
          )
        }
      : skipToken
  })
}
