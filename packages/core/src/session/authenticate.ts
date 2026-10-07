import type { AuthInternals } from "../core/auth-internals"
import { unauthenticated } from "../http/auth-api-error"
import { inspectToken } from "../jwt/verify-token"
import { selectOne } from "../lib/select-one"
import { sessionAge } from "./session-token"

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

/** Access JWTs never fall back to cookies. */
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

/**
 * The caller and their user, from a session that is still live.
 *
 * For the endpoints that act on the account: a revoked session's token still
 * verifies until it expires, and this refuses it anyway.
 *
 * @throws {AuthApiError} `unauthenticated` when the token, the session or the user is gone.
 */
export async function authenticateUser(
  internals: AuthInternals,
  input: CallerInput
) {
  const caller = await authenticate(internals, input)
  const [user, session] = await Promise.all([
    selectOne(internals, "users", { id: { eq: caller.userId } }),
    selectOne(internals, "sessions", {
      id: { eq: caller.sessionId },
      ...sessionAge(internals).live
    })
  ])
  if (!user || !session) throw unauthenticated()

  return { caller, user }
}
