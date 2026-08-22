import { AuthApiError, unauthenticated } from "../../http/auth-api-error"
import { defineEndpoint } from "../../http/define-endpoint"
import { clearCookie, shouldUseSecureCookies } from "../../lib/serialize-cookie"
import { resolveSession } from "../../session/resolve-session"

/** Input for revoking one session. */
export interface RevokeSessionInput {
  id: string
  headers?: Headers
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
}

/**
 * Revokes one of the signed-in user's sessions.
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
    const resolved = await resolveSession(internals, headers)
    if (!resolved) throw unauthenticated()

    // The delete filters on id AND userId and returns what it removed, so one
    // statement both enforces ownership and tells us whether anything was
    // there. No read-then-delete window for someone else's id to slip through.
    const [revoked] = await internals.db.delete({
      table: "sessions",
      where: { id: input.id, userId: resolved.user.id }
    })
    if (!revoked) throw new AuthApiError("notFound", 404)

    // Revoking the session you are using is a local sign-out, so the cookie has
    // to go too — otherwise the browser keeps presenting a token that no longer
    // resolves and every later request looks mysteriously unauthenticated.
    const current = revoked.tokenHash === resolved.tokenHash
    const responseHeaders = new Headers()
    if (current) {
      responseHeaders.append(
        "set-cookie",
        clearCookie(
          internals.config.cookie.name,
          internals.config.cookie.path,
          shouldUseSecureCookies(input.requestURL)
        )
      )
    }

    return {
      data: { current } satisfies RevokeSessionResult,
      headers: responseHeaders
    }
  }
})
