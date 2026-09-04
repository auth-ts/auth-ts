import { skipToken, useQuery } from "@tanstack/react-query"

import { postgrest, reviveDates } from "../db/postgrest"

/** The query key a user's linked providers live under, shared so disconnecting can invalidate it. */
export const identitiesQueryKey = (userId?: string) => ["identities", userId]

/** Every provider linked to this account, alphabetical. */
export function useIdentities(userId?: string) {
  return useQuery({
    queryKey: identitiesQueryKey(userId),
    queryFn: userId
      ? async () => {
          const { data } = await postgrest
            .from("identities")
            .select()
            .order("provider", { ascending: true })
            .throwOnError()

          return data.map((identity) =>
            reviveDates(identity, "createdAt", "updatedAt")
          )
        }
      : skipToken
  })
}
