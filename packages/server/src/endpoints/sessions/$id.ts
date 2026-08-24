import type { AuthUser } from "../../core/auth-db"
import { AuthApiError } from "../../http/auth-api-error"
import { defineEndpoint } from "../../http/define-endpoint"
import { reapGuests } from "../../lib/sweep-expired"
import type { EndpointDocs } from "../../openapi/endpoint-docs"
import {
  pruneDeadAccounts,
  readAccountsCookie
} from "../../session/accounts-cookie"
import type { CallerInput } from "../../session/authenticate"
import { authenticate } from "../../session/authenticate"
import { mintAccessToken } from "../../session/issue-session"
import { promoteNextAccount } from "../../session/promote-account"
import { clearedRefreshCookies } from "../../session/session-cookies"

/** Input for revoking one session. */
export interface RevokeSessionInput extends CallerInput {
  id: string
  requestURL?: string
}

/** What revoking a session reports back. */
export interface RevokeSessionResult {
  /**
   * Whether the revoked session was the one making the request — in which
   * case this was a local sign-out, the cookie has been cleared, and a client
   * should drop its own state too. Reported here so the client does not have
   * to list every session first just to learn what the server already knew.
   */
  current: boolean
  /**
   * The account the browser moved to, when revoking the current session left
   * another one parked here under `multiAccount`. Revoking the session you are
   * using is a local sign-out, and a sign-out that stranded the browser on no
   * account while it still held live ones would be a session nobody could see
   * to revoke.
   */
  switchedTo?: AuthUser
  /** That account's access token, present whenever `switchedTo` is. */
  token?: string
}

/** How `DELETE /sessions/$id` appears in the OpenAPI document. */
export const revokeSessionDocs: EndpointDocs<RevokeSessionInput, "id"> = {
  description: "Revoking the current session signs this device out.",
  tag: "Session",
  auth: "bearer",
  params: { id: "The session's id, as listed by `GET /sessions`." },
  responses: {
    200: {
      description: "Revoked.",
      setsCookie: "refresh",
      schema: "RevokeSessionResult"
    },
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

    // Revoking the session you are using is a local sign-out, so the cookie has
    // to go too — otherwise the browser keeps presenting a token that no longer
    // resolves and every later request looks mysteriously unauthenticated.
    const current = revoked.id === caller.sessionId
    if (!current) {
      const data: RevokeSessionResult = { current }
      return { data }
    }

    const context = { requestURL: input.requestURL, headers }
    const parked = internals.config.multiAccount
      ? await pruneDeadAccounts(
          internals,
          readAccountsCookie(internals, headers)
        )
      : []
    const promoted = await promoteNextAccount(internals, parked, context)
    if (promoted) {
      const data: RevokeSessionResult = {
        current,
        switchedTo: promoted.user,
        token: await mintAccessToken(
          internals,
          promoted.user,
          promoted.session.id
        )
      }
      return { data, headers: promoted.headers }
    }

    const responseHeaders = new Headers()
    for (const cookie of clearedRefreshCookies(internals, context)) {
      responseHeaders.append("set-cookie", cookie)
    }

    const data: RevokeSessionResult = { current }
    return { data, headers: responseHeaders }
  }
})
