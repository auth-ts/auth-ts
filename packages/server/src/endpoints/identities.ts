import { defineEndpoint } from "../http/define-endpoint"
import { IDENTITY_PAGE_SIZE } from "../oauth/link-identity"
import type { EndpointDocs } from "../openapi/endpoint-docs"
import type { CallerInput } from "../session/authenticate"
import { authenticate } from "../session/authenticate"

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

/** List the connected providers. */
export const listIdentities = defineEndpoint({
  method: "GET",
  path: "/identities",
  parse: ({ request }): CallerInput => ({ headers: request.headers }),
  run: async (internals, input: CallerInput) => {
    const caller = await authenticate(internals, input)

    // No columns to strip: the provider tokens live in `identitySecrets`, so
    // the row is safe to return whole. Read them through `getProviderToken`,
    // which refreshes rather than handing back a spent one.
    const data = await internals.db.select({
      table: "identities",
      where: { userId: caller.userId },
      limit: IDENTITY_PAGE_SIZE,
      offset: 0,
      orderBy: { provider: "asc" }
    })
    return { data }
  }
})
