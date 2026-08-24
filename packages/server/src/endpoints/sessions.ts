import type { AuthSession } from "../core/auth-db"
import { defineEndpoint } from "../http/define-endpoint"
import type { EndpointDocs } from "../openapi/endpoint-docs"
import type { CallerInput } from "../session/authenticate"
import { authenticate } from "../session/authenticate"
import { listUserSessions } from "../session/list-user-sessions"

/**
 * One entry in the "your devices" list: the row, less the hash.
 *
 * `updatedAt` is when the session was last used, which is what a device list is
 * usually asked to show. Which of them is the current one is the caller's own
 * comparison — `GET /user` and `GET /session` both hand back the session making
 * the request, so its `id` is already in hand.
 *
 * The dates are `Date` on both sides of the wire: JSON carries them as ISO
 * strings, and `@auth-ts/client` revives them, so application code never has to
 * know they were ever serialized. Anyone calling `GET /sessions` without the
 * client receives the ISO strings.
 */
export type SessionInfo = Omit<AuthSession, "tokenHash">

/** How `GET /sessions` appears in the OpenAPI document. */
export const listSessionsDocs: EndpointDocs<never> = {
  tag: "Session",
  auth: "bearer",
  responses: {
    200: {
      description: "The user's live sessions.",
      schema: { type: "array", items: "Session" }
    },
    401: "Unauthenticated"
  }
}

/**
 * List the current user's sessions.
 *
 * `tokenHash` never crosses to the browser — `id` is the only address a client
 * ever sees, and it is the only thing revocation needs.
 *
 * This lives in core rather than in application code because marking the
 * current session means hashing the raw refresh token and comparing, and the
 * raw token is something application code never handles — and, once
 * `cookie.path` is narrowed to the auth mount, cannot even see.
 *
 * Newest first, capped at the page size {@link listUserSessions} reads. A person
 * with more live sessions than that has a device list nobody scrolls and a
 * problem this screen is not going to solve.
 */
export const listSessions = defineEndpoint({
  method: "GET",
  path: "/sessions",
  parse: ({ request }): CallerInput => ({ headers: request.headers }),
  run: async (internals, input: CallerInput) => {
    const caller = await authenticate(internals, input)

    const sessions = await listUserSessions(internals, caller.userId)
    const data: SessionInfo[] = sessions.map(
      ({ tokenHash, ...session }) => session
    )

    return { data }
  }
})
