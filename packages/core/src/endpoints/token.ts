import type { AuthUser } from "../core/auth-db"
import { defineEndpoint } from "../http/define-endpoint"
import { sha256Hex } from "../lib/hash"
import { selectOne } from "../lib/select-one"
import type { EndpointDocs } from "../openapi/endpoint-docs"
import { mintAccessToken } from "../session/issue-session"
import type { HeadersInput } from "../session/resolve-session"
import { readRefreshToken, resolveSession } from "../session/resolve-session"
import {
  clearedRefreshCookies,
  readRefreshCookies,
  refreshCookies
} from "../session/session-cookies"

/** What `GET /token` and `auth.getToken` return when somebody is signed in. */
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

/** The request, plus its URL — read to scope the cookies this endpoint retires. */
export interface TokenInput extends HeadersInput {
  requestURL?: string
}

/** How `GET /token` appears in the OpenAPI document. */
export const getTokenDocs: EndpointDocs<TokenInput> = {
  description: "Answers 200 with null when nobody is signed in.",
  tag: "Session",
  auth: "cookie",
  responses: {
    200: {
      description:
        "The access token and its user, or `null` when nobody is signed in.",
      setsCookie: "refresh",
      schema: "TokenResult"
    }
  }
}

/**
 * Get an access token.
 *
 * The only endpoint that authenticates from the cookie, and therefore the only
 * one that touches a session: every other endpoint reads the token this
 * produces and does no session work at all. A page that calls four of them
 * costs one session write, not four.
 *
 * No session answers `null` with a 200 rather than a 401. This is the one
 * question in the library whose honest answer can be "nobody", and the callers
 * asking it — a client deciding what to render, a loader deciding whether to
 * greet someone — are not in a failure state. It also lets the answer carry
 * `Set-Cookie`, which a thrown error cannot: whatever dead credential the
 * browser presented is expired on the way out, so the next page load asks
 * nothing at all.
 *
 * An `Authorization` header is ignored rather than honoured. A caller holding a
 * live token has no reason to be here, and one holding a spent token is here
 * precisely because it is spent.
 *
 * The refresh token is **not** rotated. The cookie is `HttpOnly`, host-only,
 * and never crosses an origin, so rotation would buy very little; what it would
 * reliably buy is a race between concurrent tabs, where the second presents a
 * token the first has already spent.
 */
export const getToken = defineEndpoint({
  method: "GET",
  path: "/token",
  parse: ({ request }): TokenInput => ({
    headers: request.headers,
    requestURL: request.url
  }),
  run: async (internals, input: TokenInput) => {
    const { config } = internals
    const resolved = await resolveSession(internals, input.headers)
    if (!resolved) {
      // Every credential is resolved before any of it is retired. This answer
      // is about the one cookie the hint named; a browser holding another
      // user's live session must not be signed out of it, and a cookie cleared
      // while its row lives on strands a session nobody can reach.
      const presented = [...readRefreshCookies(internals, input.headers)]
      const spent = await Promise.all(
        presented.map(async ([userId, rawToken]) => {
          const live = await selectOne(internals, "sessions", {
            tokenHash: await sha256Hex(rawToken),
            expiresAt: { gt: new Date() }
          })

          return live?.userId === userId ? null : userId
        })
      )

      const headers = new Headers()
      for (const cookie of clearedRefreshCookies(internals, {
        ...input,
        userIds: spent.filter((userId) => userId !== null)
      })) {
        headers.append("set-cookie", cookie)
      }

      return { data: null, headers }
    }

    const token = await mintAccessToken(
      internals,
      resolved.user,
      resolved.session
    )

    const headers = new Headers()
    const rawToken = readRefreshToken(internals, input.headers)?.token
    if (config.session.sliding && rawToken) {
      // The browser deletes the cookie `ttl` after it was last *written*, not
      // last used — without this re-send a sliding session row outlives its own
      // cookie. Dropping the Set-Cookie (a server render cannot apply one)
      // loses nothing: the value is unchanged and the next browser call re-ups.
      for (const cookie of refreshCookies(internals, {
        rawToken,
        userId: resolved.user.id,
        requestURL: input.requestURL,
        headers: input.headers
      })) {
        headers.append("set-cookie", cookie)
      }
    }

    return {
      data: { token, user: resolved.user } satisfies TokenResult,
      headers
    }
  }
})
