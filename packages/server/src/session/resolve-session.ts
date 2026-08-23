import type { AuthSession, AuthUser } from "../core/auth-db"
import type { AuthServerInternals } from "../core/auth-server-internals"
import { sha256Hex } from "../lib/hash"
import { readCookie } from "../lib/parse-cookies"
import { selectOne } from "../lib/select-one"
import { slideSession } from "./slide-session"

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

/** Reads the refresh token from the cookie — the only place it ever travels. */
export function readRefreshToken(
  internals: AuthServerInternals,
  headers: Headers
) {
  return readCookie(headers, internals.config.cookie.name)
}

/**
 * Resolves the session row alone, without reading the user.
 *
 * One statement: the session is found and touched together, matched on the hash
 * and on an expiry still ahead of now. Expiry is therefore enforced here rather
 * than trusted to a cleanup sweep — an expired row simply matches nothing, and
 * a dead session cannot be revived by the write that would have extended it.
 *
 * Sliding on the way through means being in the application keeps a session
 * alive, and the columns say when it was last used rather than when it was last
 * written to.
 *
 * @returns The session and the hash it was found by, or `null`.
 */
export async function resolveSessionRow(
  internals: AuthServerInternals,
  headers: Headers
): Promise<Omit<ResolvedSession, "user"> | null> {
  const rawToken = readRefreshToken(internals, headers)
  if (!rawToken) {
    internals.log.debug("no refresh credential on request")
    return null
  }

  const tokenHash = await sha256Hex(rawToken)
  const [session] = await slideSession(internals, tokenHash, headers)
  if (!session) {
    internals.log.debug("no live session for this refresh credential")
    return null
  }

  return { session, tokenHash }
}

/**
 * Resolves the caller's session and the user it belongs to.
 *
 * @returns The session and user, or `null` if there is no live session.
 */
export async function resolveSession(
  internals: AuthServerInternals,
  headers: Headers
): Promise<ResolvedSession | null> {
  const resolved = await resolveSessionRow(internals, headers)
  if (!resolved) return null

  const user = await selectOne(internals, "users", {
    id: resolved.session.userId
  })
  if (!user) {
    // Core deletes a user's sessions before the user, so a session pointing at
    // nothing means a delete failed part-way. Refuse it rather than trust it.
    internals.log.warn("session references a user that no longer exists")
    return null
  }

  return { ...resolved, user }
}
