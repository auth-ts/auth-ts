import type { AuthSession } from "../core/auth-db"
import type { AuthServerInternals } from "../core/auth-server-internals"
import { unauthenticated } from "../http/auth-api-error"
import { inspectToken } from "../jwt/verify-token"
import { sha256Hex } from "../lib/hash"
import { mintAccessToken } from "./issue-session"
import { readRefreshToken, resolveSession } from "./resolve-session"

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

/** Who is calling, the cookie hash if one rode along, and anything to send back. */
export interface Caller {
  userId: string
  /** Present whenever a refresh cookie rode along — it is a hash, not a lookup. */
  tokenHash: string | null
  /**
   * Headers the response must carry: a new access token, when this request had
   * to fall back to the cookie to authenticate.
   *
   * Every endpoint returns these, so any request can refresh the token. There
   * is no endpoint whose job that is.
   */
  headers: Headers
  /**
   * The session, when the cookie was what authenticated this request.
   *
   * Carried rather than dropped: the fallback has just read and touched the row,
   * so an endpoint that needs it should not go and read it again.
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
 * cookie. An expired token falls through to the cookie, because expiry is
 * ordinary. A
 * token that fails any other check is refused outright rather than ignored:
 * falling back there would turn a forged token into a slower request instead of
 * an error.
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
  const cookieToken = headers ? readRefreshToken(internals, headers) : undefined
  const tokenHash = cookieToken ? await sha256Hex(cookieToken) : null
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

    if (verdict.status === "valid" && verdict.claims.sub) {
      // Nothing to send back: the token they hold is the token they need.
      return { userId: verdict.claims.sub, tokenHash, headers: new Headers() }
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
  minted.set(TOKEN_HEADER, await mintAccessToken(internals, resolved.user))

  return {
    userId: resolved.user.id,
    tokenHash: resolved.tokenHash,
    headers: minted,
    session: resolved.session
  }
}
