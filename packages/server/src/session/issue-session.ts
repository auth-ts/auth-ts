import type { AuthUser } from "../core/auth-db"
import type { AuthServerInternals } from "../core/auth-server-internals"
import { signToken } from "../jwt/sign-token"
import { randomBytesBase64url } from "../lib/generate-random"
import { sha256Hex } from "../lib/hash"
import { insertRow } from "../lib/insert-row"
import { getIpAddress } from "../lib/ip-address"
import { parseDuration } from "../lib/parse-duration"
import {
  serializeCookie,
  shouldUseSecureCookies
} from "../lib/serialize-cookie"
import {
  demoteActive,
  parkedTokens,
  pruneDeadAccounts,
  readAccountsCookie,
  serializeAccounts
} from "./accounts-cookie"
import { readRefreshToken } from "./resolve-session"

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
  const ipAddress = getIpAddress(headers, internals.config.ipAddress)

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
  /**
   * The request's URL, when there is one.
   *
   * Read only to decide whether cookies carry `Secure`; absent for an endpoint
   * called in-process, where {@link shouldUseSecureCookies} assumes they should.
   */
  requestURL?: string
  mode?: IssueMode
  /**
   * Token hash of a session this one supersedes.
   *
   * That session is deleted rather than left live, and under `multiAccount` it
   * is not parked either. Used when a guest completes a sign-in: whether they
   * were upgraded in place or merged into an existing account, the anonymous
   * session has served its purpose, and a stranded guest in the account
   * switcher — or a still-valid refresh token for one — helps nobody.
   *
   * Without `multiAccount` this is also implied: whatever session the request
   * presented is replaced by the one being issued, because the browser is
   * about to overwrite its cookie with the new token and a row nothing can
   * reach any more is a live credential nobody can see to revoke.
   */
  replaces?: string
}

/**
 * Creates a session and mints an access token — the single path every sign-in
 * method ends at.
 *
 * Verification code, guest, OAuth, and account switching all converge here, so cookie
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
  const { config } = internals
  const rawToken = randomBytesBase64url(32)
  const tokenHash = await sha256Hex(rawToken)
  const now = new Date()

  await insertRow(internals, "sessions", {
    userId: user.id,
    tokenHash,
    createdAt: now,
    expiresAt: new Date(now.getTime() + parseDuration(config.session.ttl)),
    ...sessionStamp(internals, headers)
  })

  // Without multiAccount a sign-in replaces rather than appends: the session
  // the request presented is about to become unreachable from this browser,
  // so it is deleted rather than left to run out its month-long lifetime
  // somewhere nobody can revoke it. Under multiAccount it is parked below.
  const presented = readRefreshToken(internals, headers)
  const superseded =
    replaces ??
    (!config.multiAccount && presented ? await sha256Hex(presented) : undefined)

  // Only once the replacement exists: if creating it had failed, the caller
  // would still hold a working session rather than none.
  if (superseded && superseded !== tokenHash) {
    await internals.db.delete({
      table: "sessions",
      where: { tokenHash: superseded }
    })
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
      name: config.cookie.name,
      value: rawToken,
      path: config.cookie.path,
      maxAge: config.session.ttl,
      secure
    })
  )

  if (config.multiAccount) {
    // Sign-ins append rather than replace: the previous active session moves to
    // the parked list so the user can switch back to it.
    const parked = parkedTokens(
      await pruneDeadAccounts(internals, readAccountsCookie(internals, headers))
    )
    // A superseded session is gone, not parked; anything else the browser had
    // active is demoted as usual.
    const presentedWasSuperseded =
      presented !== undefined &&
      replaces !== undefined &&
      (await sha256Hex(presented)) === replaces
    const nextParked =
      presented && !presentedWasSuperseded
        ? await demoteActive(internals, parked, presented)
        : parked

    responseHeaders.append(
      "set-cookie",
      serializeCookie({
        name: config.cookie.accountsName,
        value: serializeAccounts(nextParked),
        path: config.cookie.path,
        maxAge: config.session.ttl,
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
  const { config } = internals
  const { signingKey, kid } = await internals.keys()

  return signToken(
    {
      signingKey,
      algorithm: config.jwt.alg,
      kid,
      ttl: config.jwt.ttl,
      claims: config.jwt.claims,
      ...(config.issuer ? { issuer: config.issuer } : {}),
      ...(config.jwt.audience ? { audience: config.jwt.audience } : {})
    },
    { userId: user.id, type: user.type }
  )
}

/**
 * Extends a session's expiry on refresh, when sliding is enabled.
 *
 * `createdAt` is never named here, and that is the point: the update touches
 * expiry and the stamp only, so the timestamp recording when identity was
 * proven — the one account deletion checks — cannot be slid by accident.
 *
 * @returns The expiry now in effect — the one just persisted, or the existing
 * one when sliding is off — so a caller reports what the row actually says
 * rather than what it said before this ran.
 */
export async function slideSession(
  internals: AuthServerInternals,
  session: { id: string; expiresAt: Date },
  headers: Headers
): Promise<Date> {
  if (!internals.config.session.sliding) return session.expiresAt
  internals.log.debug("sliding session expiry")

  const expiresAt = new Date(
    Date.now() + parseDuration(internals.config.session.ttl)
  )
  await internals.db.update({
    table: "sessions",
    where: { id: session.id },
    values: { expiresAt, ...sessionStamp(internals, headers) }
  })

  return expiresAt
}
