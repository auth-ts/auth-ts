import type { AuthSession, AuthUser } from "../core/auth-db.ts"
import type { AuthServerInternals } from "../core/auth-server-internals.ts"
import { sha256Hex } from "../lib/hash.ts"
import { readCookie } from "../lib/parse-cookies.ts"

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
export function readRefreshToken(
  internals: AuthServerInternals,
  headers: Headers
) {
  const fromCookie = readCookie(headers, internals.options.cookie.name)
  if (fromCookie) return fromCookie

  // The /i matters: the Bearer scheme is case-insensitive per RFC 6750.
  return headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]
}

/**
 * Resolves the caller's session from the refresh cookie or bearer token.
 *
 * Expiry is enforced here, on read, rather than trusted to a cleanup sweep —
 * cleanup is hygiene, and a session must be dead the moment it expires whether or
 * not anything has swept.
 *
 * @returns The session and user, or `null` if there is no live session.
 */
export async function resolveSession(
  internals: AuthServerInternals,
  headers: Headers
): Promise<ResolvedSession | null> {
  const rawToken = readRefreshToken(internals, headers)
  if (!rawToken) return null

  const tokenHash = await sha256Hex(rawToken)
  const session = await internals.db.getSession({ tokenHash })
  if (!session) return null

  if (session.expiresAt.getTime() <= Date.now()) {
    internals.log.debug("session expired on read")
    return null
  }

  const user = await internals.db.getUser({ id: session.userId })
  if (!user) {
    // The user was deleted but a session survived: the cascade contract was not
    // honoured. Refuse the session rather than trusting the row.
    internals.log.warn("session references a user that no longer exists")
    return null
  }

  return { session, user, tokenHash }
}
