import type { AuthConnection } from "../core/auth-db"
import { defineEndpoint } from "../http/define-endpoint"
import { CONNECTION_PAGE_SIZE } from "../oauth/link-connection"
import type { CallerInput } from "../session/authenticate"
import { authenticate } from "../session/authenticate"

/** One linked provider, as shown on an account screen. */
export type ConnectionInfo = AuthConnection

/** Lists the signed-in user's linked providers. */
export const listConnections = defineEndpoint({
  method: "GET",
  path: "/connections",
  parse: ({ request }): CallerInput => ({ headers: request.headers }),
  run: async (internals, input: CallerInput) => {
    const caller = await authenticate(internals, input)

    const connections = await internals.db.select({
      table: "connections",
      where: { userId: caller.userId },
      limit: CONNECTION_PAGE_SIZE,
      offset: 0,
      orderBy: { provider: "asc" }
    })
    return {
      data: connections satisfies ConnectionInfo[]
    }
  }
})
