import type { AuthSession } from "../core/auth-db"
import { unauthenticated } from "../http/auth-api-error"
import { defineEndpoint } from "../http/define-endpoint"
import { selectOne } from "../lib/select-one"
import type { EndpointDocs } from "../openapi/endpoint-docs"
import type { CallerInput } from "../session/authenticate"
import { authenticate } from "../session/authenticate"

/** The caller's own session — the row, less the hash. */
export type CurrentSession = Omit<AuthSession, "tokenHash">

/** How `GET /session` appears in the OpenAPI document. */
export const getSessionDocs: EndpointDocs<never> = {
  description: "Its id tells you which entry in /sessions is this device.",
  tag: "Session",
  auth: "bearer",
  responses: {
    200: { description: "The caller's own session.", schema: "Session" },
    401: "Unauthenticated"
  }
}

/**
 * Gets the current session.
 *
 * Authenticated from the access token like everything else, whose `sid` says
 * which row to read — one read of `sessions`, no write. Sessions are touched on
 * `GET /token` and nowhere else.
 *
 * Its `id` is how a device list tells which entry is this device.
 */
export const getSession = defineEndpoint({
  method: "GET",
  path: "/session",
  parse: ({ request }): CallerInput => ({ headers: request.headers }),
  run: async (internals, input: CallerInput) => {
    const caller = await authenticate(internals, input)
    const found = await selectOne(internals, "sessions", {
      id: caller.sessionId
    })
    if (!found) throw unauthenticated()

    const { tokenHash, ...session } = found

    return { data: session satisfies CurrentSession }
  }
})
