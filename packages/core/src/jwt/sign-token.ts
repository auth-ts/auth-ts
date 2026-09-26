import { SignJWT } from "jose"
import type { UserType } from "../core/auth-database"
import type { Duration } from "../lib/parse-duration"
import { parseDurationSeconds } from "../lib/parse-duration"
import type { JwtAlgorithm } from "./import-signing-key"

/** Claims for `signToken`. Other keys pass through; `iat` and `exp` are refused. */
export type SignTokenClaims = {
  /** Becomes `sub`, the only way to set it. */
  userId?: string
  /** What row-level security policies read, e.g. `auth.session()->>'type'`. */
  type?: UserType
  /**
   * The Postgres role PostgREST assumes. It must exist, with grants.
   * @default "authenticated"
   */
  role?: string
  /** Set `userId` instead. */
  sub?: never
  /** Always the signing time. */
  iat?: never
  /** Always `iat` plus `jwt.ttl`. */
  exp?: never
} & Record<string, unknown>

/** What {@link signToken} needs to know, resolved from the server options. */
export interface SignTokenContext {
  signingKey: CryptoKey
  algorithm: JwtAlgorithm
  kid: string
  ttl: Duration
  /** Claims merged under the caller's — caller wins. */
  claims: Record<string, unknown>
  /** Default `iss`; a caller-supplied `iss` wins. */
  issuer?: string
  /** Default `aud`; a caller-supplied `aud` wins. */
  audience?: string
}

/**
 * Signs a JWT.
 *
 * This is the private key with a function signature: it mints whatever it is
 * given, with no session check, so it must never be exposed through a route.
 *
 * It performs no database read. Stamping identity is the caller's job —
 * `signToken({ userId, type })` — which keeps a background job acting as a user
 * and an ordinary sign-in on exactly the same path.
 *
 * Everything in the payload is readable by anyone holding the token and is
 * shipped to the database on every query, so no secrets belong in it.
 */
export async function signToken(
  context: SignTokenContext,
  claims: SignTokenClaims = {}
) {
  // `sub` is taken out along with `userId`, not just typed away: the `never`
  // holds at compile time, but a widened `Record<string, unknown>` payload can
  // still carry one, and `setSubject` only runs when `userId` is given — so
  // without this a smuggled `sub` would reach the token unchanged.
  const { userId, sub: _sub, ...rest } = claims
  // The configured defaults get the same treatment: `jwt.claims` is refused a
  // `sub` at startup, but this function is also reachable with a hand-built
  // context, and `setSubject` only runs when `userId` is given.
  const { sub: _configuredSub, ...configuredClaims } = context.claims
  // Configured values are defaults under the caller's claims. The setters below
  // run after this and overwrite, so `iat` and `exp` are the server's alone.
  const payload = {
    ...configuredClaims,
    ...(context.issuer ? { iss: context.issuer } : {}),
    ...(context.audience ? { aud: context.audience } : {}),
    ...rest
  }

  const issuedAt = Math.floor(Date.now() / 1000)
  const signer = new SignJWT(payload)
    .setProtectedHeader({ alg: context.algorithm, kid: context.kid })
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + parseDurationSeconds(context.ttl))

  if (userId !== undefined) signer.setSubject(userId)

  return signer.sign(context.signingKey)
}
