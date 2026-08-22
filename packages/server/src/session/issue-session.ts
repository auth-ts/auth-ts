import type { AuthUser } from "../core/auth-db.ts"
import type { AuthServerInternals } from "../core/auth-server-internals.ts"
import { signToken } from "../jwt/sign-token.ts"
import { randomBytesBase64url, randomUUID } from "../lib/generate-random.ts"
import { getClientIp } from "../lib/get-client-ip.ts"
import { sha256Hex } from "../lib/hash.ts"
import { parseDuration } from "../lib/parse-duration.ts"
import {
  serializeCookie,
  shouldUseSecureCookies
} from "../lib/serialize-cookie.ts"
import {
  demoteActive,
  pruneDeadAccounts,
  readAccountsCookie,
  serializeAccounts
} from "./accounts-cookie.ts"
import { readRefreshToken } from "./resolve-session.ts"

/**
 * Where the refresh token goes.
 *
 * `"cookie"` is the default and the only mode browsers should use. `"token"`
 * returns the refresh token in the body for native and CLI clients that have no
 * cookie jar — with the consequence, documented loudly, that the client is then
 * responsible for storing a long-lived credential safely.
 */
export type IssueMode = "cookie" | "token"

/** User-agent and validated client IP for a session row, from the request headers. */
function sessionStamp(internals: AuthServerInternals, headers: Headers) {
  const userAgent = headers.get("user-agent")
  const ipAddress = getClientIp(headers, internals.options.clientIp)

  return {
    ...(userAgent ? { userAgent } : {}),
    ...(ipAddress ? { ipAddress } : {})
  }
}

/** What issuing a session produced. */
export interface IssueResult {
  accessToken: string
  user: AuthUser
  /** Present only in `"token"` mode. */
  refreshToken?: string
  /** `Set-Cookie` headers the caller must send. */
  headers: Headers
}

/** Everything issuing needs from the request. */
export interface IssueSessionInput {
  user: AuthUser
  headers: Headers
  requestURL: string
  mode?: IssueMode
  /**
   * Token hash of a session this one supersedes.
   *
   * That session is deleted rather than left live, and under `multiAccount` it
   * is not parked either. Used when a guest completes a sign-in: whether they
   * were upgraded in place or merged into an existing account, the anonymous
   * session has served its purpose, and a stranded guest in the account
   * switcher — or a still-valid refresh token for one — helps nobody.
   */
  replaces?: string
}

/**
 * Creates a session and mints an access token — the single path every sign-in
 * method ends at.
 *
 * Magic code, guest, OAuth, and account switching all converge here, so cookie
 * attributes, session stamping, and multi-account behaviour are defined once
 * rather than re-implemented per method with slightly different mistakes.
 *
 * The database is given only `sha256(token)`. Possession of the raw token proves
 * identity; the stored hash proves nothing on its own, so a leaked table cannot
 * be replayed and a leaked token cannot be located in the table.
 */
export async function issueSession(
  internals: AuthServerInternals,
  { user, headers, requestURL, mode = "cookie", replaces }: IssueSessionInput
): Promise<IssueResult> {
  const { options } = internals
  const rawToken = randomBytesBase64url(32)
  const tokenHash = await sha256Hex(rawToken)
  const now = new Date()

  await internals.db.upsertSession({
    id: randomUUID(),
    userId: user.id,
    tokenHash,
    createdAt: now,
    expiresAt: new Date(now.getTime() + parseDuration(options.session.ttl)),
    ...sessionStamp(internals, headers)
  })

  // Only once the replacement exists: if creating it had failed, the caller
  // would still hold a working session rather than none.
  if (replaces) {
    await internals.db.deleteSession({ tokenHash: replaces })
    internals.log.debug("superseded session deleted")
  }

  const responseHeaders = new Headers()
  const accessToken = await mintAccessToken(internals, user)
  internals.log.debug("session issued", { userType: user.type, mode })

  if (mode === "token") {
    return {
      accessToken,
      user,
      refreshToken: rawToken,
      headers: responseHeaders
    }
  }

  const secure = shouldUseSecureCookies(requestURL)
  responseHeaders.append(
    "set-cookie",
    serializeCookie({
      name: options.cookie.name,
      value: rawToken,
      path: options.cookie.path,
      maxAge: options.session.ttl,
      secure
    })
  )

  if (options.multiAccount) {
    // Sign-ins append rather than replace: the previous active session moves to
    // the parked list so the user can switch back to it.
    const previousActive = readRefreshToken(internals, headers)
    const parked = await pruneDeadAccounts(
      internals,
      readAccountsCookie(internals, headers)
    )
    // A superseded session is gone, not parked; anything else the browser had
    // active is demoted as usual.
    const superseded =
      previousActive !== undefined &&
      replaces !== undefined &&
      (await sha256Hex(previousActive)) === replaces
    const nextParked =
      previousActive && !superseded
        ? await demoteActive(internals, parked, previousActive)
        : parked

    responseHeaders.append(
      "set-cookie",
      serializeCookie({
        name: options.cookie.accountsName,
        value: serializeAccounts(nextParked),
        path: options.cookie.path,
        maxAge: options.session.ttl,
        secure
      })
    )
  }

  return { accessToken, user, headers: responseHeaders }
}

/**
 * Signs an access token for a user.
 *
 * `type` rides along because row-level security reads it; `role` stays whatever
 * the configuration says, because it maps to a real Postgres role. `primaryUserId`
 * is deliberately never included — it describes a pending data migration, not who
 * is signed in.
 */
export async function mintAccessToken(
  internals: AuthServerInternals,
  user: AuthUser
) {
  const { options } = internals
  const { signingKey, kid } = await internals.keys()

  return signToken(
    {
      signingKey,
      algorithm: options.jwt.alg,
      kid,
      ttl: options.jwt.ttl,
      claims: options.jwt.claims,
      ...(options.issuer ? { issuer: options.issuer } : {}),
      ...(options.jwt.audience ? { audience: options.jwt.audience } : {})
    },
    { userId: user.id, type: user.type }
  )
}

/**
 * Extends a session's expiry on refresh, when sliding is enabled.
 *
 * `createdAt` is passed through unchanged: it records when identity was proven,
 * which is what account deletion checks. Sliding it would let a browser left open
 * for a month look freshly authenticated.
 *
 * @returns The expiry now in effect — the one just persisted, or the existing
 * one when sliding is off — so a caller reports what the row actually says
 * rather than what it said before this ran.
 */
export async function slideSession(
  internals: AuthServerInternals,
  session: {
    id: string
    userId: string
    tokenHash: string
    createdAt: Date
    expiresAt: Date
  },
  headers: Headers
): Promise<Date> {
  if (!internals.options.session.sliding) return session.expiresAt
  internals.log.debug("sliding session expiry")

  const expiresAt = new Date(
    Date.now() + parseDuration(internals.options.session.ttl)
  )
  await internals.db.upsertSession({
    id: session.id,
    userId: session.userId,
    tokenHash: session.tokenHash,
    createdAt: session.createdAt,
    expiresAt,
    ...sessionStamp(internals, headers)
  })

  return expiresAt
}
