import type { JWK, JWTVerifyGetKey } from "jose"
import { createLocalJWKSet, jwtVerify } from "jose"
import type { UserType } from "../core/auth-db"
import type { JwtAlgorithm } from "./import-signing-key"

/**
 * Claims as a token states them, before anything has been checked.
 *
 * Every field is optional because a well-formed JWT may omit any of them — this
 * is what {@link decodeToken} returns, and it promises nothing more than "this
 * is what the token says".
 */
export interface UnverifiedClaims {
  /** The user id, absent on service tokens minted without one. */
  sub?: string
  type?: UserType
  role?: string
  iss?: string
  aud?: string | string[]
  iat?: number
  exp?: number
  [claim: string]: unknown
}

/**
 * A verified token's claims.
 *
 * `iat` and `exp` are required here because {@link verifyToken} requires them:
 * a token without an expiry never expires, and a signature alone does not make
 * that acceptable. Narrowing the type is honest only because verification
 * enforces it.
 */
export interface TokenClaims extends UnverifiedClaims {
  iat: number
  exp: number
}

/**
 * Resolves a token's header to the published public key.
 *
 * This is the local twin of what a remote verifier does against `jwks.json`:
 * the key is picked by the header's `kid` and `alg` from the published set, so
 * a token a remote verifier would refuse — one naming a `kid` the key set does
 * not carry — is refused here too, rather than verified by signature alone.
 */
export type VerificationKeySet = JWTVerifyGetKey

/** Builds a {@link VerificationKeySet} from the public JWK `jwks.json` publishes. */
export function createVerificationKeySet(publicJwk: JWK): VerificationKeySet {
  return createLocalJWKSet({ keys: [publicJwk] })
}

/** What {@link verifyToken} needs, resolved from the server options. */
export interface VerifyTokenContext {
  /** The published public key, selected by `kid`. */
  keys: VerificationKeySet
  algorithm: JwtAlgorithm
  issuer?: string
  audience?: string
}

/**
 * Verifies a token locally — no database, no network.
 *
 * The algorithm allowlist is exactly the configured algorithm, which is what
 * closes algorithm confusion: a token whose header claims `HS256`, signed using
 * the public key as an HMAC secret, is rejected before its signature is even
 * considered. `iss` and `aud` are enforced only when configured, so a deployment
 * that sets neither is not silently accepting tokens meant for somewhere else —
 * it simply has no such constraint to check.
 *
 * A 60 second clock tolerance absorbs skew between machines. It does not accept
 * expired tokens: it acknowledges that two servers rarely agree on the second,
 * and without it a valid token fails on whichever host is running slightly fast.
 *
 * `iat` and `exp` are required, not merely checked when present. jose validates
 * an expiry it finds and says nothing about one it does not, so without this a
 * token minted elsewhere with the same key that simply omits `exp` would verify
 * and never expire. Core's own tokens always carry both, so nothing it signs is
 * affected.
 *
 * @returns The claims, or `null` for any failure at all — bad signature, unknown
 * `kid`, wrong algorithm, wrong audience or issuer, expired, or malformed.
 * Callers get one thing to check rather than a taxonomy of ways to be
 * unauthenticated.
 */
export async function verifyToken(
  context: VerifyTokenContext,
  token: string
): Promise<TokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, context.keys, {
      algorithms: [context.algorithm],
      clockTolerance: "60s",
      requiredClaims: ["iat", "exp"],
      ...(context.issuer ? { issuer: context.issuer } : {}),
      ...(context.audience ? { audience: context.audience } : {})
    })

    return payload as TokenClaims
  } catch {
    return null
  }
}
