import type { AuthUser } from "../core/auth-db"
import { unauthenticated } from "../http/auth-api-error"
import { defineEndpoint } from "../http/define-endpoint"
import { mintAccessToken } from "../session/issue-session"
import type { HeadersInput } from "../session/resolve-session"
import { resolveSession } from "../session/resolve-session"

/** What `GET /token` and `authServer.getToken` return. */
export interface TokenResult {
  token: string
  /**
   * The user the token was minted for.
   *
   * Minting reads this row for the `type` claim, so returning it costs nothing
   * and saves the caller a second request on the one call every client and
   * every server-rendered page starts from.
   */
  user: AuthUser
}

/**
 * Exchanges the refresh cookie for an access token.
 *
 * The only endpoint that authenticates from the cookie, and therefore the only
 * one that touches a session: every other endpoint reads the token this
 * produces and does no session work at all. A page that calls four of them
 * costs one session write, not four.
 *
 * An `Authorization` header is ignored rather than honoured. A caller holding a
 * live token has no reason to be here, and one holding a spent token is here
 * precisely because it is spent.
 *
 * The refresh token is **not** rotated. The cookie is `HttpOnly`, host-only,
 * and never crosses an origin, so rotation would buy very little; what it would
 * reliably buy is a race between concurrent tabs, where the second presents a
 * token the first has already spent.
 *
 * @throws {AuthApiError} `unauthenticated` when there is no live session.
 */
export const getToken = defineEndpoint({
  method: "GET",
  path: "/token",
  parse: ({ request }): HeadersInput => ({ headers: request.headers }),
  run: async (internals, input: HeadersInput) => {
    const resolved = await resolveSession(internals, input.headers)
    if (!resolved) throw unauthenticated()

    const token = await mintAccessToken(
      internals,
      resolved.user,
      resolved.session.id
    )

    return { data: { token, user: resolved.user } satisfies TokenResult }
  }
})
