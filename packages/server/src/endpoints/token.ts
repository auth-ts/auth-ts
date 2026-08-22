import type { AuthUser } from "../core/auth-db"
import { unauthenticated } from "../http/auth-api-error"
import { defineEndpoint } from "../http/define-endpoint"
import { mintAccessToken, slideSession } from "../session/issue-session"
import type { HeadersInput } from "../session/resolve-session"
import { resolveSession } from "../session/resolve-session"

/**
 * The session as a token response describes it — a projection, never the row.
 *
 * `tokenHash` must not cross to the browser; `id` is the only address a client
 * ever needs, and `createdAt` is the authentication time that server-side
 * freshness checks read. Listed field by field, rather than spread from
 * `AuthSession`, so adding a column to the stored row can never silently widen
 * what a refresh returns.
 */
export interface TokenSession {
  /** The browser-safe address of this session, for `revokeSession`. */
  id: string
  /** When identity was proven — what the deletion freshness window reads. */
  createdAt: Date
  expiresAt: Date
}

/** What `POST /token` and `authServer.getToken` return. */
export interface AuthTokenResult {
  accessToken: string
  user: AuthUser
  session: TokenSession
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

    // The expiry reported below is the one sliding just persisted, not the one
    // the row had when it was read — otherwise every refresh would describe a
    // session that is already out of date.
    const expiresAt = await slideSession(
      internals,
      { ...resolved.session, tokenHash: resolved.tokenHash },
      input.headers
    )

    const accessToken = await mintAccessToken(internals, resolved.user)

    return {
      data: {
        accessToken,
        user: resolved.user,
        session: {
          id: resolved.session.id,
          createdAt: resolved.session.createdAt,
          expiresAt
        }
      } satisfies AuthTokenResult
    }
  }
})
