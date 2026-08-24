import { AuthApiError } from "../../http/auth-api-error"
import { defineEndpoint } from "../../http/define-endpoint"
import { reapGuests } from "../../lib/sweep-expired"
import type { EndpointDocs } from "../../openapi/endpoint-docs"
import type { CallerInput } from "../../session/authenticate"
import { authenticate } from "../../session/authenticate"
import { clearedRefreshCookies } from "../../session/session-cookies"

/** Input for revoking one session. */
export interface RevokeSessionInput extends CallerInput {
  id: string
  requestURL?: string
}

/** How `DELETE /sessions/$id` appears in the OpenAPI document. */
export const revokeSessionDocs: EndpointDocs<RevokeSessionInput, "id"> = {
  description:
    "Revoking the session you are on signs this browser out of that account. Any other accounts signed in here are untouched.",
  tag: "Session",
  auth: "bearer",
  params: { id: "The session's id, as listed by `GET /sessions`." },
  responses: {
    204: { description: "Revoked.", setsCookie: "refresh" },
    401: "Unauthenticated",
    404: "NotFound"
  }
}

/**
 * Revokes a session.
 *
 * Ownership is enforced inside the delete query rather than by comparing ids
 * first: the `where` names both `id` and `userId`, so revoking someone else's
 * session is structurally impossible instead of depending on a check being
 * present.
 *
 * Revoking one session revokes that session. It never promotes another account
 * into its place — switching is something the application asks for, not
 * something a delete does on its way out.
 */
export const revokeSession = defineEndpoint({
  method: "DELETE",
  path: "/sessions/$id",
  parse: ({ request, params }): RevokeSessionInput => ({
    id: params.id ?? "",
    headers: request.headers,
    requestURL: request.url
  }),
  run: async (internals, input: RevokeSessionInput) => {
    const headers = input.headers ?? new Headers()
    const caller = await authenticate(internals, input)

    // The delete filters on id AND userId and returns what it removed, so one
    // statement both enforces ownership and tells us whether anything was
    // there. No read-then-delete window for someone else's id to slip through.
    const [revoked] = await internals.db.delete({
      table: "sessions",
      where: { id: input.id, userId: caller.userId }
    })
    if (!revoked) throw new AuthApiError("notFound", 404)
    await reapGuests(internals, [revoked])

    if (revoked.id !== caller.sessionId) return { data: undefined, status: 204 }

    // Revoking the session you are using leaves the browser presenting a token
    // that no longer resolves, so its cookie goes too. The accounts cookie is
    // left alone: those sessions are still live, and this said nothing about them.
    const responseHeaders = new Headers()
    for (const cookie of clearedRefreshCookies(internals, {
      requestURL: input.requestURL,
      headers
    })) {
      responseHeaders.append("set-cookie", cookie)
    }

    return { data: undefined, status: 204, headers: responseHeaders }
  }
})
