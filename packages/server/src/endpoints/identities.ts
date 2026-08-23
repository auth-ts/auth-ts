import type { AuthIdentity } from "../core/auth-db"
import { defineEndpoint } from "../http/define-endpoint"
import { IDENTITY_PAGE_SIZE } from "../oauth/link-identity"
import type { CallerInput } from "../session/authenticate"
import { authenticate } from "../session/authenticate"

/** One linked provider, as shown on an account screen. */
export type IdentityInfo = AuthIdentity

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
    return {
      data: identities satisfies IdentityInfo[]
    }
  }
})
