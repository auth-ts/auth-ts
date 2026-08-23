import { skipToken, useQuery } from "@tanstack/react-query"

import { postgrest } from "../db/postgrest"

/** The query key a user's linked providers live under, shared so disconnecting can invalidate it. */
export const identitiesQueryKey = (userId?: string) => ["identities", userId]

/** Every provider linked to this account, alphabetical. */
export function useIdentities(userId?: string) {
  return useQuery({
    queryKey: identitiesQueryKey(userId),
    queryFn: userId
      ? async () => {
          // Columns named rather than `*`: the two token columns are revoked
          // from this role, and PostgREST expands `*` to every column of the
          // table — including the ones it may not read.
          const { data } = await postgrest
            .from("identities")
            .select(
              "id, userId, provider, providerUserId, label, scope, accessTokenExpiresAt, createdAt, updatedAt"
            )
            .order("provider", { ascending: true })
            .throwOnError()

          return data.map((identity) => ({
            ...identity,
            createdAt: new Date(identity.createdAt),
            updatedAt: new Date(identity.updatedAt)
          }))
        }
      : skipToken
  })
}
