import type { AuthUser } from "../core/auth-database"
import { unauthenticated } from "../http/auth-api-error"
import { defineEndpoint } from "../http/define-endpoint"
import { readBody } from "../http/read-body"
import { selectOne } from "../lib/select-one"
import type { EndpointDocs } from "../openapi/endpoint-docs"
import { deleteSessions } from "../session/delete-sessions"
import { mintAccessToken } from "../session/issue-session"
import { presentedSessions } from "../session/presented-sessions"
import type { HeadersInput } from "../session/resolve-session"
import {
  readRefreshToken,
  resolveBearerSession,
  resolveSession
} from "../session/resolve-session"
import {
  clearedRefreshCookies,
  refreshCookies
} from "../session/session-cookies"
import { isBearerTransport } from "../shared/session-transport"

/** A live access token and its user. */
export interface TokenResult {
  token: string
  multiUser?: boolean
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

/** Documents cookie and bearer session exchange. */
export const getTokenDocs: EndpointDocs<TokenInput> = {
  description: "Answers 200 with null when nobody is signed in.",
  tag: "Session",
  auth: "session",
  responses: {
    401: "Unauthenticated",
    200: {
      description:
        "The access token and its user, or `null` when nobody is signed in.",
      setsCookie: "refresh",
      schema: { oneOf: ["TokenResult", { type: "null" }] }
    }
  }
}

/** Get an access token. */
export const getToken = defineEndpoint({
  method: "POST",
  path: "/token",
  parse: async ({ request }): Promise<TokenInput> => {
    await readBody(request, [])
    return { headers: request.headers, requestURL: request.url }
  },
  run: async (internals, input: TokenInput) => {
    const { config } = internals
    const bearer = isBearerTransport(input.headers)
    const resolved = bearer
      ? await resolveBearerSession(internals, input.headers)
      : await resolveSession(internals, input.headers)
    if (bearer && !resolved) throw unauthenticated()
    if (!resolved) {
      // Every credential is resolved before any of it is retired. This answer
      // is about the one cookie the hint named; a browser holding another
      // user's live session must not be signed out of it, and a cookie cleared
      // while its row lives on strands a session nobody can reach.
      const presented = await presentedSessions(internals, input.headers)
      const spent = await Promise.all(
        presented.map(async ({ userId, session: live }) => {
          if (live?.userId !== userId) return userId

          // Orphaned session: its user row is gone
          const user = await selectOne(internals, "users", {
            id: { eq: userId }
          })
          if (user) return null
          await deleteSessions(internals, { id: { eq: live.id } })

          return userId
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
      data: {
        token,
        user: resolved.user,
        ...(bearer ? { multiUser: config.multiUser } : {})
      } satisfies TokenResult,
      headers
    }
  }
})
