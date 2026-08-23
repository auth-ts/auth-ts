import type { AuthServerInternals } from "../core/auth-server-internals"
import { unauthenticated } from "../http/auth-api-error"
import { inspectToken } from "../jwt/verify-token"
import { sha256Hex } from "../lib/hash"
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

/** Who is calling, and the hash of the session cookie they sent, if they sent one. */
export interface Caller {
  userId: string
  /** Present whenever a refresh cookie rode along — it is a hash, not a lookup. */
  tokenHash: string | null
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
      return { userId: verdict.claims.sub, tokenHash }
    }
    if (verdict.status === "invalid") {
      internals.log.debug("bearer token did not verify")
      throw unauthenticated()
    }
    internals.log.debug("bearer token expired, falling back to the cookie")
  }

  if (!headers) throw unauthenticated()

  const resolved = await resolveSession(internals, headers)
  if (!resolved) throw unauthenticated()

  return { userId: resolved.user.id, tokenHash: resolved.tokenHash }
}
