import type { AuthSession, AuthUser } from "../core/auth-db"
import type { AuthServerInternals } from "../core/auth-server-internals"
import { sha256Hex } from "../lib/hash"
import { readCookie } from "../lib/parse-cookies"
import { selectOne } from "../lib/select-one"

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
  const fromCookie = readCookie(headers, internals.config.cookie.name)
  if (fromCookie) return fromCookie

  // The /i matters: the Bearer scheme is case-insensitive per RFC 6750.
  return headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]
}

/**
 * Resolves the caller's session from the refresh cookie or bearer token.
 *
 * Expiry is enforced here, on read, rather than trusted to a cleanup sweep —
 * cleanup is hygiene, and a session must be dead the moment it expires whether
 * or not anything has swept. An expired row read here is also deleted here.
 *
 * @returns The session and user, or `null` if there is no live session.
 */
export async function resolveSession(
  internals: AuthServerInternals,
  headers: Headers
): Promise<ResolvedSession | null> {
  const rawToken = readRefreshToken(internals, headers)
  if (!rawToken) {
    internals.log.debug("no refresh credential on request")
    return null
  }

  const tokenHash = await sha256Hex(rawToken)
  const session = await selectOne(internals, "sessions", { tokenHash })
  if (!session) {
    internals.log.debug("refresh credential does not match a stored session")
    return null
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    // Deleted, not merely refused: the row is already in hand, so removing it
    // costs nothing the sweep would not eventually pay, and a deployment that
    // never sweeps still does not accumulate dead sessions on live traffic.
    await internals.db.delete({ table: "sessions", where: { id: session.id } })
    internals.log.debug("session expired on read")
    return null
  }

  const user = await selectOne(internals, "users", { id: session.userId })
  if (!user) {
    // Core deletes a user's sessions before the user, so a session pointing at
    // nothing means a delete failed part-way. Refuse it rather than trust it.
    internals.log.warn("session references a user that no longer exists")
    return null
  }

  return { session, user, tokenHash }
}
