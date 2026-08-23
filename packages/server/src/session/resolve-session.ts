import type { AuthSession, AuthUser } from "../core/auth-db"
import type { AuthServerInternals } from "../core/auth-server-internals"
import { sha256Hex } from "../lib/hash"
import { readCookie } from "../lib/parse-cookies"
import { selectOne } from "../lib/select-one"
import type { CallerInput } from "./authenticate"
import { verifyBearer } from "./authenticate"
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

/**
 * Resolves the session the caller is acting from, by token where it can.
 *
 * For the handful of endpoints that need the *session*, not just who is
 * calling: the guest a sign-in is about to convert, the account a connect flow
 * links to. A live token names the session outright, and reading that row costs
 * no write. Anything else — no token, a spent one, or one naming a session
 * since revoked — falls through to the cookie, which is what makes this work
 * for `/connect/:provider` and the OAuth callback, both of which arrive as
 * top-level navigations that can carry no `Authorization` header.
 *
 * The expiry check has to be here as well as in `slideSession`: `selectOne` by
 * id would happily return a row whose lifetime has run out.
 *
 * @returns The session and user, or `null` when neither credential resolves.
 */
export async function resolveCallerSession(
  internals: AuthServerInternals,
  input: CallerInput
): Promise<ResolvedSession | null> {
  const { caller } = await verifyBearer(internals, input)

  if (caller) {
    const session = await selectOne(internals, "sessions", {
      id: caller.sessionId,
      expiresAt: { gt: new Date() }
    })
    const user = session
      ? await selectOne(internals, "users", { id: session.userId })
      : null

    if (session && user) return { session, user, tokenHash: session.tokenHash }
  }

  return input.headers ? resolveSession(internals, input.headers) : null
}
