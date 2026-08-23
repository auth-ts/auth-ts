import { skipToken, useQuery } from "@tanstack/react-query"

import { postgrest } from "../db/postgrest"

/** The query key a user's sessions live under, shared so revoking can invalidate it. */
export const sessionsQueryKey = (userId?: string) => ["sessions", userId]

/**
 * Every session on this account, newest first.
 *
 * Columns are named because `tokenHash` is revoked from `authenticated`, and
 * `select()` asks for `*` — which Postgres denies for the whole table rather
 * than narrowing to the columns the role can read.
 */
export function useSessions(userId?: string) {
  return useQuery({
    queryKey: sessionsQueryKey(userId),
    queryFn: userId
      ? async () => {
          const { data } = await postgrest
            .from("sessions")
            .select("id,userAgent,ipAddress,expiresAt,createdAt,updatedAt")
            .order("createdAt", { ascending: false })
            .throwOnError()

          return data.map((session) => ({
            ...session,
            expiresAt: new Date(session.expiresAt),
            createdAt: new Date(session.createdAt),
            updatedAt: new Date(session.updatedAt)
          }))
        }
      : skipToken
  })
}
