import { skipToken, useQuery } from "@tanstack/react-query"

import { postgrest } from "../db/postgrest"

/** The query key a user's linked providers live under, shared so disconnecting can invalidate it. */
export const connectionsQueryKey = (userId?: string) => ["connections", userId]

/** Every provider linked to this account, alphabetical. */
export function useConnections(userId?: string) {
  return useQuery({
    queryKey: connectionsQueryKey(userId),
    queryFn: userId
      ? async () => {
          const { data } = await postgrest
            .from("connections")
            .select()
            .order("provider", { ascending: true })
            .throwOnError()

          return data.map((connection) => ({
            ...connection,
            createdAt: new Date(connection.createdAt),
            updatedAt: new Date(connection.updatedAt)
          }))
        }
      : skipToken
  })
}
