import { AuthApiError, unauthenticated } from "../../http/auth-api-error.ts"
import { defineEndpoint } from "../../http/define-endpoint.ts"
import {
  clearCookie,
  shouldUseSecureCookies
} from "../../lib/serialize-cookie.ts"
import { resolveSession } from "../../session/resolve-session.ts"

/** Input for revoking one session. */
export interface RevokeSessionInput {
  id: string
  headers?: Headers
  requestURL?: string
}

/**
 * Revokes one of the signed-in user's sessions.
 *
 * Ownership is enforced inside the delete query rather than by comparing ids
 * first: `deleteSession({ id, userId })` filters on both columns, so revoking
 * someone else's session is structurally impossible instead of depending on a
 * check being present.
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

    const owned = await internals.db.listSessions({ userId: resolved.user.id })
    const target = owned.find((session) => session.id === input.id)
    if (!target) throw new AuthApiError("notFound", 404)

    await internals.db.deleteSession({ id: input.id, userId: resolved.user.id })

    // Revoking the session you are using is a local sign-out, so the cookie has
    // to go too — otherwise the browser keeps presenting a token that no longer
    // resolves and every later request looks mysteriously unauthenticated.
    if (target.tokenHash === resolved.tokenHash) {
      const responseHeaders = new Headers()
      responseHeaders.append(
        "set-cookie",
        clearCookie(
          internals.options.cookie.name,
          internals.options.cookie.path,
          shouldUseSecureCookies(input.requestURL ?? "https://localhost")
        )
      )

      return { data: undefined, status: 204, headers: responseHeaders }
    }

    return { data: undefined, status: 204 }
  }
})
