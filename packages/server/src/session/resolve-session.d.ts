import type { AuthSession, AuthUser } from "../core/auth-db.ts"
import type { AuthServerInternals } from "../core/auth-server-internals.ts"
/**
 * The minimal carrier for anything that reads the refresh cookie.
 *
 * A `Request` satisfies this structurally, so `getToken(request)` compiles; and
 * headers-only contexts — Next's `headers()`, a TanStack server function, tRPC's
 * context, middleware — need no fake `Request`. It is `Headers` rather than a
 * plain record deliberately: `Headers` normalizes casing, so `Cookie` and
 * `cookie` cannot become a bug.
 */
export interface HeadersInput {
  headers: Headers
}
/** A resolved session together with its user and the hash that found it. */
export interface ResolvedSession {
  session: AuthSession
  user: AuthUser
  /** The lookup key. Never sent to the browser — `session.id` is the safe address. */
  tokenHash: string
}
/**
 * Extracts the raw refresh token from a request.
 *
 * The cookie wins over the `Authorization` header: a browser that has both is a
 * browser whose cookie is authoritative, and preferring a header there would let
 * a caller downgrade to a token they supplied.
 */
export declare function readRefreshToken(
  internals: AuthServerInternals,
  headers: Headers
): string | undefined
/**
 * Resolves the caller's session from the refresh cookie or bearer token.
 *
 * Expiry is enforced here, on read, rather than trusted to a cleanup sweep —
 * cleanup is hygiene, and a session must be dead the moment it expires whether or
 * not anything has swept.
 *
 * @returns The session and user, or `null` if there is no live session.
 */
export declare function resolveSession(
  internals: AuthServerInternals,
  headers: Headers
): Promise<ResolvedSession | null>
//# sourceMappingURL=resolve-session.d.ts.map
