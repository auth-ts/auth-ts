import type { AuthSession } from "../core/auth-db"
import type { AuthServerInternals } from "../core/auth-server-internals"
import { unauthenticated } from "../http/auth-api-error"
import { inspectToken } from "../jwt/verify-token"
import { mintAccessToken } from "./issue-session"
import { resolveSession } from "./resolve-session"

/**
 * How a caller identifies itself: a request's headers, an access token, or both.
 *
 * `token` is for callers with no request to hand over — server-side rendering
 * that already fetched one, another service holding a token. Over HTTP the
 * token arrives in the `Authorization` header instead, and both end up here.
 */
export interface CallerInput {
  headers?: Headers
  token?: string
}

/** The response header a freshly minted access token is delivered in. */
export const TOKEN_HEADER = "x-auth-token"

/** Who is calling, which session they are acting from, and anything to send back. */
export interface Caller {
  userId: string
  /** The session the credential came from: the token's `sid`, or the cookie's row. */
  sessionId: string
  /**
   * Headers the response must carry: a new access token, when this request had
   * to fall back to the cookie to authenticate.
   *
   * Every endpoint returns these, so any request can refresh the token. There
   * is no endpoint whose job that is.
   */
  headers: Headers
  /**
   * The session row, when the cookie was what authenticated this request.
   *
   * Carried rather than dropped: the fallback has just read and touched the row,
   * so an endpoint that needs it should not go and read it again. Absent when
   * the token did the work — read it by `sessionId` if it is needed.
   */
  session?: AuthSession
}

/**
 * Authenticates a request, from its access token where there is one.
 *
 * The token is the point of issuing tokens: it names the caller without a
 * database round trip, so an endpoint that only needs a user id does no work to
 * find one. The cookie is the fallback, and it is what makes the direct-call
 * API usable from server-side rendering, where there is a request to hand over
 * but no access token to go with it.
 *
 * A token passed directly wins over one in a header, which wins over the
 * cookie. A token that does not verify — expired, forged, minted under a key
 * since rotated, or simply unreadable — is treated as absent: the cookie is
 * consulted and, if it holds a live session, a replacement is minted. A client
 * holding a spoiled token self-heals rather than being handed an error it
 * cannot act on, and a forged one buys nothing but the cookie path.
 *
 * The cost of trusting the token is revocation latency — a session revoked
 * elsewhere keeps working here until the token expires. That is the same bound
 * the database already lives with, since it authorizes on the token too.
 */
export async function authenticate(
  internals: AuthServerInternals,
  input: CallerInput
): Promise<Caller> {
  const { headers } = input
  // The /i matters: the Bearer scheme is case-insensitive per RFC 6750.
  const bearer =
    input.token ?? headers?.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]

  let reason: "missing" | "expired" | "invalid" = "missing"

  if (bearer) {
    const { config } = internals
    const { verificationKeys } = await internals.keys()
    const verdict = await inspectToken(
      {
        keys: verificationKeys,
        algorithm: config.jwt.alg,
        ...(config.issuer ? { issuer: config.issuer } : {}),
        ...(config.jwt.audience ? { audience: config.jwt.audience } : {})
      },
      bearer
    )

    if (
      verdict.status === "valid" &&
      verdict.claims.sub &&
      typeof verdict.claims.sid === "string"
    ) {
      // Nothing to send back: the token they hold is the token they need.
      return {
        userId: verdict.claims.sub,
        sessionId: verdict.claims.sid,
        headers: new Headers()
      }
    }
    reason = verdict.status === "expired" ? "expired" : "invalid"
  }

  // Logged on every fallback, including the one nobody thinks about — a caller
  // that sends no token at all. Counting these is how a client that has stopped
  // reading the token header shows up as a graph rather than as an unexplained
  // load on the database: a healthy deployment falls back about once per token
  // lifetime per client, and no more.
  internals.log.debug("authenticating from the cookie", { reason })

  if (!headers) throw unauthenticated()

  // The cookie path is also the refresh path, and the only place a session is
  // touched. A token lives ten minutes, so this runs about that often rather
  // than on every request.
  const resolved = await resolveSession(internals, headers)
  if (!resolved) throw unauthenticated()

  const minted = new Headers()
  minted.set(
    TOKEN_HEADER,
    await mintAccessToken(internals, resolved.user, resolved.session.id)
  )

  return {
    userId: resolved.user.id,
    sessionId: resolved.session.id,
    headers: minted,
    session: resolved.session
  }
}
