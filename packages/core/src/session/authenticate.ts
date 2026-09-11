import type { AuthInternals } from "../core/auth-internals"
import { unauthenticated } from "../http/auth-api-error"
import { inspectToken } from "../jwt/verify-token"

/**
 * How a caller identifies itself: a request's headers, an access token, or both.
 *
 * `token` is for callers with no request to hand over — server-side rendering
 * that fetched one from `getToken`, another service holding a token. Over HTTP
 * the token arrives in the `Authorization` header instead, and both end up here.
 * `headers` is still read for cookies by the endpoints that manage this
 * browser's cookie state, so passing both is normal.
 */
export interface CallerInput {
  headers?: Headers
  token?: string
}

/** Who is calling, and which session they are acting from. */
export interface Caller {
  userId: string
  /** The session the token was minted from — its `sid` claim. */
  sessionId: string
}

/**
 * Reads the caller out of an access token, without touching the database.
 *
 * A token passed directly wins over one in a header. Anything that does not
 * verify — expired, forged, minted under a key since rotated, unreadable — is
 * `null` along with the reason, which is all the difference callers need: one
 * refuses, the other falls back to the cookie.
 */
export async function verifyBearer(
  internals: AuthInternals,
  input: CallerInput
): Promise<{
  caller: Caller | null
  reason: "missing" | "expired" | "invalid"
}> {
  const { headers } = input
  // The /i matters: the Bearer scheme is case-insensitive per RFC 6750.
  const bearer =
    input.token ?? headers?.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!bearer) return { caller: null, reason: "missing" }

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
    return {
      caller: { userId: verdict.claims.sub, sessionId: verdict.claims.sid },
      reason: "missing"
    }
  }

  return {
    caller: null,
    reason: verdict.status === "expired" ? "expired" : "invalid"
  }
}

/**
 * Authenticates a request from its access token, and only from its token.
 *
 * The token names the caller without a database round trip, so an endpoint that
 * needs a user id does no work to find one — no session read, no session write,
 * no signature. That is the whole point of issuing tokens, and it only holds if
 * there is no second way in: a cookie fallback here would mean every endpoint
 * slides a session and mints a replacement for any caller that arrived without
 * a token, which is every server-rendered request.
 *
 * Exchanging the cookie for a token is `GET /token`, and it is the only
 * endpoint that reads the cookie to authenticate. A caller whose token is spent
 * goes there and comes back; there is nothing to self-heal here.
 *
 * The cost of trusting the token is revocation latency — a session revoked
 * elsewhere keeps working here until the token expires. That is the same bound
 * the database already lives with, since it authorizes on the token too.
 *
 * @throws {AuthApiError} `unauthenticated` when no live token was presented.
 */
export async function authenticate(
  internals: AuthInternals,
  input: CallerInput
): Promise<Caller> {
  const { caller, reason } = await verifyBearer(internals, input)
  if (caller) return caller

  // Worth counting: a healthy client refuses about never, because `getToken`
  // refreshes ahead of expiry. A rate above that is a client that has stopped
  // refreshing, showing up as a graph rather than as user reports.
  internals.log.debug("refusing a request with no live token", { reason })

  throw unauthenticated()
}
