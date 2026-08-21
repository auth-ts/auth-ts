import type { UserType } from "../core/auth-db.ts"
import type { Duration } from "../lib/parse-duration.ts"
import type { JwtAlgorithm } from "./import-signing-key.ts"
/**
 * Claims you may put in a token.
 *
 * Anything not listed passes through untouched, so policies can read whatever
 * your schema needs. The envelope claims are typed `never` on purpose: `iat`,
 * `exp`, `iss`, and `aud` are owned by the server's configuration, and the type
 * rejects overriding them rather than letting a caller quietly mint a token that
 * outlives its TTL.
 */
export type SignTokenClaims = {
  /** Becomes `sub`. */
  userId?: string
  /** What row-level security policies read, e.g. `auth.session()->>'type'`. */
  type?: UserType
  /**
   * The Postgres role PostgREST assumes. Defaults to `authenticated`.
   *
   * Override only for a database role that actually exists with grants, or every
   * query fails. Application-level roles belong in `type`.
   */
  role?: string
  iat?: never
  exp?: never
  iss?: never
  aud?: never
} & Record<string, unknown>
/** What {@link signToken} needs to know, resolved from the server options. */
export interface SignTokenContext {
  signingKey: CryptoKey
  algorithm: JwtAlgorithm
  kid: string
  ttl: Duration
  /** Claims merged under the caller's — caller wins. */
  claims: Record<string, unknown>
  issuer?: string
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
export declare function signToken(
  context: SignTokenContext,
  claims?: SignTokenClaims
): Promise<string>
//# sourceMappingURL=sign-token.d.ts.map
