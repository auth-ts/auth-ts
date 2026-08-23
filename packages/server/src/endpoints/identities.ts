import type { AuthIdentity } from "../core/auth-db"
import { defineEndpoint } from "../http/define-endpoint"
import { IDENTITY_PAGE_SIZE } from "../oauth/link-identity"
import type { CallerInput } from "../session/authenticate"
import { authenticate } from "../session/authenticate"

/**
 * One linked provider, as shown on an account screen.
 *
 * The two credentials are gone from it. They are encrypted at rest, but a
 * ciphertext on a screen is a liability with no use — the only legitimate way
 * to reach a provider's API is `getProviderToken`, which hands back a
 * short-lived access token and never the durable half. The expiries and the
 * granted `scope` stay: an account screen has real work for them, like saying
 * an integration needs reconnecting.
 */
export type IdentityInfo = Omit<AuthIdentity, "accessToken" | "refreshToken">

/** Lists the signed-in user's linked providers. */
export const listIdentities = defineEndpoint({
  method: "GET",
  path: "/identities",
  parse: ({ request }): CallerInput => ({ headers: request.headers }),
  run: async (internals, input: CallerInput) => {
    const caller = await authenticate(internals, input)

    const identities = await internals.db.select({
      table: "identities",
      where: { userId: caller.userId },
      limit: IDENTITY_PAGE_SIZE,
      offset: 0,
      orderBy: { provider: "asc" }
    })
    const data: IdentityInfo[] = identities.map(
      ({ accessToken, refreshToken, ...identity }) => identity
    )

    return { data }
  }
})
