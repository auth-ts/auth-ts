import { unauthenticated } from "../http/auth-api-error"
import { defineEndpoint } from "../http/define-endpoint"
import { CONNECTION_PAGE_SIZE } from "../oauth/link-connection"
import type { HeadersInput } from "../session/resolve-session"
import { resolveSession } from "../session/resolve-session"

/** One linked provider, as shown on an account screen. */
export interface ConnectionInfo {
  provider: string
  /** The address the provider reported. Metadata only — never the match key. */
  email?: string | null
}

/** Lists the signed-in user's linked providers. */
export const listConnections = defineEndpoint({
  method: "GET",
  path: "/connections",
  parse: ({ request }): HeadersInput => ({ headers: request.headers }),
  run: async (internals, input: HeadersInput) => {
    const resolved = await resolveSession(internals, input.headers)
    if (!resolved) throw unauthenticated()

    const connections = await internals.db.select({
      table: "connections",
      where: { userId: resolved.user.id },
      limit: CONNECTION_PAGE_SIZE,
      offset: 0,
      orderBy: { provider: "asc" }
    })
    const data: ConnectionInfo[] = connections.map((connection) => ({
      provider: connection.provider,
      email: connection.email ?? null
    }))

    return { data: { connections: data } }
  }
})
