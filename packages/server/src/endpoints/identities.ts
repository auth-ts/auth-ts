import type { AuthIdentity } from "../core/auth-db"
import { defineEndpoint } from "../http/define-endpoint"
import { IDENTITY_PAGE_SIZE } from "../oauth/link-identity"
import type { EndpointDocs } from "../openapi/endpoint-docs"
import type { CallerInput } from "../session/authenticate"
import { authenticate } from "../session/authenticate"

/**
 * One connected provider, as shown on an account screen.
 *
 * The two credentials are gone from it. They are encrypted at rest, but a
 * ciphertext on a screen is a liability with no use — the only legitimate way
 * to reach a provider's API is `getProviderToken`, which hands back a
 * short-lived access token and never the durable half.
 *
 * `accessTokenExpiresAt` goes with them, for a different reason: an expiry is
 * worth knowing to whoever holds the token it describes, and a listing holds no
 * token. `getProviderToken` reports the expiry of the one it returns, which is
 * the moment that answer can be acted on. Here it would only churn on every
 * refresh and invite a caller to reimplement the refreshing that already
 * happened for them.
 *
 * `refreshTokenExpiresAt` and `scope` stay, because a screen has real work for
 * them: when the connection itself dies, and what it was allowed to do.
 */
export type IdentityInfo = Omit<
  AuthIdentity,
  "accessTokenEncrypted" | "refreshTokenEncrypted" | "accessTokenExpiresAt"
>

/** How `GET /identities` appears in the OpenAPI document. */
export const listIdentitiesDocs: EndpointDocs<never> = {
  description:
    "Provider tokens are not included. Use /identities/{id}/token for those.",
  tag: "Identities",
  auth: "bearer",
  responses: {
    200: {
      description: "The user's connected providers.",
      schema: { type: "array", items: "Identity" }
    },
    401: "Unauthenticated"
  }
}

/** List connected providers. */
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
      ({
        accessTokenEncrypted,
        refreshTokenEncrypted,
        accessTokenExpiresAt,
        ...identity
      }) => identity
    )

    return { data }
  }
})
