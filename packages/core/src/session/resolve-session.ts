import type { AuthSession, AuthUser } from "../core/auth-database"
import type { AuthInternals } from "../core/auth-internals"
import { sha256Hex } from "../lib/hash"
import { readCookie } from "../lib/parse-cookies"
import { selectOne } from "../lib/select-one"
import { HINT_COOKIE_NAME } from "../shared/hint-cookie"
import type { CallerInput } from "./authenticate"
import { verifyBearer } from "./authenticate"
import { readRefreshCookies } from "./session-cookies"
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

/**
 * Reads one user's refresh token from the cookies — the only place it travels.
 *
 * Without a `userId` the hint decides, since it names whoever was made active
 * last. That keeps the hot path at one cookie read and one session read no
 * matter how many users are signed in here. A hint pointing at a cookie this
 * browser does not hold falls back to any it does, which is what makes a
 * script-rewritten hint a no-op rather than a way to look signed out.
 *
 * The `userId` returned is the cookie's name — a claim, not a fact. Only the
 * session row the token resolves to says whose it is.
 */
export function readRefreshToken(
  internals: AuthInternals,
  headers: Headers,
  userId?: string
): { userId: string; token: string } | undefined {
  const presented = readRefreshCookies(internals, headers)
  if (userId !== undefined) {
    const token = presented.get(userId)
    return token === undefined ? undefined : { userId, token }
  }

  const hinted = readCookie(headers, HINT_COOKIE_NAME)
  if (hinted) {
    const token = presented.get(hinted)
    if (token) return { userId: hinted, token }
  }

  const [first] = presented
  return first ? { userId: first[0], token: first[1] } : undefined
}

/**
 * Finds a live session by a raw refresh token and marks it used.
 *
 * One statement: the session is found and touched together, matched on the hash
 * and on an expiry still ahead of now. Expiry is therefore enforced here rather
 * than trusted to a cleanup sweep — an expired row simply matches nothing, and
 * a dead session cannot be revived by the write that would have extended it.
 *
 * Sliding on the way through means being in the application keeps a session
 * alive, and the columns say when it was last used rather than when it was last
 * written to.
 */
async function liveSession(
  internals: AuthInternals,
  headers: Headers,
  rawToken: string | undefined
): Promise<Omit<ResolvedSession, "user"> | null> {
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
 * Resolves whichever session this browser holds, without reading the user.
 *
 * Answers for whoever the presented token turns out to belong to, because no
 * claim is being made about who that is — possession of the token is the whole
 * proof. Use {@link resolveSessionRowForUser} wherever the caller names a user.
 *
 * @returns The session and the hash it was found by, or `null`.
 */
export function resolveSessionRow(
  internals: AuthInternals,
  headers: Headers
): Promise<Omit<ResolvedSession, "user"> | null> {
  return liveSession(
    internals,
    headers,
    readRefreshToken(internals, headers)?.token
  )
}

/**
 * Resolves the session held under one user's name, and only if it is theirs.
 *
 * Separate from {@link resolveSessionRow} rather than an optional argument on
 * it, because the difference is a security boundary and an omitted parameter
 * makes one look like the other. Naming a user is a claim, and the row is what
 * settles it: a cookie's name is written by whoever sent it, and only the hash
 * inside proves anything. Without the check a caller could present their own
 * refresh token under somebody else's name and be answered with a session — and
 * through it an access token — that is not theirs.
 *
 * @returns The session and the hash it was found by, or `null`.
 */
export async function resolveSessionRowForUser(
  internals: AuthInternals,
  headers: Headers,
  userId: string
): Promise<Omit<ResolvedSession, "user"> | null> {
  const resolved = await liveSession(
    internals,
    headers,
    readRefreshToken(internals, headers, userId)?.token
  )
  if (!resolved) return null

  if (resolved.session.userId !== userId) {
    internals.log.warn("refresh cookie names a user it does not belong to")
    return null
  }

  return resolved
}

/**
 * Resolves the caller's session and the user it belongs to.
 *
 * The user is read concurrently with the session, keyed by the name the cookie
 * arrived under. That name is a claim, so the row settles it: a read that turns
 * out to name someone else is discarded and the session's own `userId` is
 * fetched instead. The forged-name case pays one extra read; the honest case —
 * every real request — pays one round-trip instead of two.
 *
 * @returns The session and user, or `null` if there is no live session.
 */
export async function resolveSession(
  internals: AuthInternals,
  headers: Headers
): Promise<ResolvedSession | null> {
  const picked = readRefreshToken(internals, headers)
  const [resolved, named] = await Promise.all([
    liveSession(internals, headers, picked?.token),
    picked ? selectOne(internals, "users", { id: { eq: picked.userId } }) : null
  ])
  if (!resolved) return null

  const user =
    named?.id === resolved.session.userId
      ? named
      : await selectOne(internals, "users", {
          id: { eq: resolved.session.userId }
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
 * For the two endpoints that need the *session* rather than just who is
 * calling — verifying a sign-in code, and the OAuth callback — because both may
 * be converting a guest whose session is about to be replaced. A live token
 * names the session outright, and reading that row costs no write. Anything
 * else — no token, a spent one, or one naming a session since revoked — falls
 * through to the cookie, which is what makes the callback work at all: it
 * arrives as a top-level navigation that can carry no `Authorization` header.
 *
 * @returns The session and user, or `null` when neither credential resolves.
 */
export async function resolveCallerSession(
  internals: AuthInternals,
  input: CallerInput
): Promise<ResolvedSession | null> {
  return (
    (await resolveTokenSession(internals, input)) ??
    (input.headers ? resolveSession(internals, input.headers) : null)
  )
}

/**
 * Resolves the session a live token names, and never the cookie.
 *
 * The half of {@link resolveCallerSession} that reads only what the token
 * says, for callers that need the answer to be about *this* token: a cookie
 * fallback would answer with whichever session the browser happens to hold,
 * which is a different question, and would slide it on the way past.
 *
 * The expiry check has to be here as well as in `slideSession`: `selectOne` by
 * id would happily return a row whose lifetime has run out.
 *
 * @returns The session and user, or `null` when no live token named a live one.
 */
export async function resolveTokenSession(
  internals: AuthInternals,
  input: CallerInput
): Promise<ResolvedSession | null> {
  const { caller } = await verifyBearer(internals, input)
  if (!caller) return null

  const session = await selectOne(internals, "sessions", {
    id: { eq: caller.sessionId },
    expiresAt: { gt: new Date() }
  })
  const user = session
    ? await selectOne(internals, "users", { id: { eq: session.userId } })
    : null

  return session && user
    ? { session, user, tokenHash: session.tokenHash }
    : null
}
