import { unauthenticated } from "../http/auth-api-error.ts"
import { defineEndpoint } from "../http/define-endpoint.ts"
import { mintAccessToken, slideSession } from "../session/issue-session.ts"
import type { HeadersInput } from "../session/resolve-session.ts"
import { resolveSession } from "../session/resolve-session.ts"

/** What `POST /token` and `authServer.getToken` return. */
export interface AuthTokenResult {
  accessToken: string
  user: import("../core/auth-db.ts").AuthUser
  session: import("../core/auth-db.ts").AuthSession
}

/**
 * Exchanges the refresh cookie for a fresh access token.
 *
 * The refresh token is **not** rotated. The cookie is `HttpOnly`, path-scoped, and
 * never crosses an origin, so rotation would buy very little; what it would
 * reliably buy is a race between concurrent tabs, where the second tab presents
 * a token the first has already spent. Consumers who store the refresh token
 * outside an `HttpOnly` cookie do need rotation and reuse detection — which is
 * exactly why this library does not support that mode.
 *
 * @throws {AuthApiError} `unauthenticated` when there is no live session.
 */
export const getToken = defineEndpoint({
  method: "POST",
  path: "/token",
  parse: ({ request }): HeadersInput => ({ headers: request.headers }),
  run: async (internals, input: HeadersInput) => {
    const resolved = await resolveSession(internals, input.headers)
    if (!resolved) throw unauthenticated()

    await slideSession(
      internals,
      { ...resolved.session, tokenHash: resolved.tokenHash },
      input.headers
    )

    const accessToken = await mintAccessToken(internals, resolved.user)

    return {
      data: {
        accessToken,
        user: resolved.user,
        session: resolved.session
      } satisfies AuthTokenResult
    }
  }
})
