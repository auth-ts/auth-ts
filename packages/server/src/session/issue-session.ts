import type { AuthUser } from "../core/auth-db"
import type { AuthServerInternals } from "../core/auth-server-internals"
import { signToken } from "../jwt/sign-token"
import { randomBytesBase64url } from "../lib/generate-random"
import { sha256Hex } from "../lib/hash"
import { insertRow } from "../lib/insert-row"
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
import { sessionStamp } from "./slide-session"

/** What issuing a session produced. */
export interface IssueResult {
  token: string
  user: AuthUser
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
  { user, headers, requestURL, replaces }: IssueSessionInput
): Promise<IssueResult> {
  const { config } = internals
  const rawToken = randomBytesBase64url(32)
  const tokenHash = await sha256Hex(rawToken)
  const now = new Date()

  const session = await insertRow(internals, "sessions", {
    userId: user.id,
    tokenHash,
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
  const token = await mintAccessToken(internals, user, session.id)
  internals.log.debug("session issued", { userType: user.type })

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

  return { token, user, headers: responseHeaders }
}

/**
 * What a token for this user would claim about them.
 *
 * `type` rides along because row-level security reads it; `role` stays whatever
 * the configuration says, because it maps to a real Postgres role. `sid` names
 * the session the token was minted from, so an endpoint authenticated by the
 * token alone still knows which session it is acting for. Nothing that
 * identifies the person does: the token is handed to the database, to sync
 * services, and to whatever logs sit between them, and none of them need a name
 * or an address to authorize a query.
 *
 * `primaryUserId` is deliberately never included either — it describes a
 * pending data migration, not who is signed in.
 */
export function accessTokenClaims(user: AuthUser, sessionId: string) {
  return { userId: user.id, type: user.type, sid: sessionId }
}

/** Signs an access token carrying {@link accessTokenClaims}. */
export async function mintAccessToken(
  internals: AuthServerInternals,
  user: AuthUser,
  sessionId: string
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
    accessTokenClaims(user, sessionId)
  )
}
