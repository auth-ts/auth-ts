import { requireOwnedClaimsAbsent } from "../core/auth-config"
import type { AuthSession, AuthUser } from "../core/auth-db"
import type { AuthInternals } from "../core/auth-internals"
import { signToken } from "../jwt/sign-token"
import { randomBytesBase64url } from "../lib/generate-random"
import { sha256Hex } from "../lib/hash"
import { insertRow } from "../lib/insert-row"
import { parseDuration } from "../lib/parse-duration"
import { selectOne } from "../lib/select-one"
import { clearCookie, shouldUseSecureCookies } from "../lib/serialize-cookie"
import { sweepExpired } from "../lib/sweep-expired"
import {
  readRefreshCookies,
  refreshCookieName,
  refreshCookies
} from "./session-cookies"
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
   * What proved identity, as RFC 8176 method references — see
   * {@link AuthSession.amr}. Required so a new sign-in path cannot forget to
   * say how it authenticated somebody.
   */
  amr: string[]
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
   * That session is deleted rather than left live. Used when a guest completes
   * a sign-in: whether they were upgraded in place or merged into an existing
   * user, the anonymous session has served its purpose, and a stranded guest in
   * the switcher — or a still-valid refresh token for one — helps nobody.
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
  internals: AuthInternals,
  { user, headers, requestURL, replaces, amr }: IssueSessionInput
): Promise<IssueResult> {
  const { config } = internals
  const rawToken = randomBytesBase64url(32)
  const tokenHash = await sha256Hex(rawToken)
  const now = new Date()

  // A cookie about to be overwritten leaves its session unreachable from this
  // browser, so it is deleted rather than left to run out a month-long lifetime
  // somewhere nobody can revoke it. Without multiUser that is every session the
  // browser presented — no row needs reading to know it. With multiUser it is
  // only this user's own previous one, and which is which comes from each row
  // rather than from the name its cookie arrived under, so a mislabelled cookie
  // retires the session it actually holds instead of being counted as somebody
  // else's and left behind.
  const [session, , held] = await Promise.all([
    insertRow(internals, "sessions", {
      userId: user.id,
      tokenHash,
      amr,
      expiresAt: new Date(now.getTime() + parseDuration(config.session.ttl)),
      ...sessionStamp(internals, headers)
    }),
    sweepExpired(internals, "sessions"),
    Promise.all(
      [...readRefreshCookies(internals, headers)].map(
        async ([cookieUserId, rawToken]) => {
          const hash = await sha256Hex(rawToken)

          return {
            cookieUserId,
            hash,
            ownerId: config.multiUser
              ? (
                  await selectOne(internals, "sessions", {
                    tokenHash: { eq: hash }
                  })
                )?.userId
              : undefined
          }
        }
      )
    )
  ])
  const stranded = held.filter(
    ({ ownerId }) => !config.multiUser || ownerId === user.id
  )
  const superseded = new Set(stranded.map(({ hash }) => hash))
  if (replaces) superseded.add(replaces)
  // Only once the replacement exists: if creating it had failed, the caller
  // would still hold a working session rather than none.
  superseded.delete(tokenHash)

  const [token] = await Promise.all([
    mintAccessToken(internals, user, session),
    ...[...superseded].map((hash) =>
      internals.db.delete({
        table: "sessions",
        where: { tokenHash: { eq: hash } }
      })
    )
  ])
  if (superseded.size > 0) internals.log.debug("superseded sessions deleted")

  const responseHeaders = new Headers()
  internals.log.debug("session issued", { userType: user.type })

  const secure = shouldUseSecureCookies(requestURL)
  for (const { cookieUserId } of stranded) {
    if (cookieUserId === user.id) continue
    responseHeaders.append(
      "set-cookie",
      clearCookie(
        refreshCookieName(config, cookieUserId),
        config.cookie.path,
        secure
      )
    )
  }
  for (const cookie of refreshCookies(internals, {
    rawToken,
    userId: user.id,
    requestURL,
    headers
  })) {
    responseHeaders.append("set-cookie", cookie)
  }

  return { token, user, headers: responseHeaders }
}

/**
 * What a token for this user would claim about them.
 *
 * `type` rides along because row-level security reads it; `role` stays whatever
 * the configuration says, because it maps to a real Postgres role. `sid` names
 * the session the token was minted from, so an endpoint authenticated by the
 * token alone still knows which session it is acting for. `amr` says what
 * proved identity, for a policy that treats a texted code and a federated
 * assertion differently — it is here rather than left to `jwt.claims` because
 * a column no token carries cannot be read by the thing it exists for. Nothing
 * that identifies the person rides along: the token is handed to the database,
 * to sync services, and to whatever logs sit between them, and none of them
 * need a name or an address to authorize a query.
 *
 * `primaryUserId` is deliberately never included either — it describes a
 * pending data migration, not who is signed in.
 */
export function accessTokenClaims(user: AuthUser, session: AuthSession) {
  return {
    userId: user.id,
    type: user.type,
    sid: session.id,
    ...(session.amr?.length ? { amr: session.amr } : {})
  }
}

/**
 * Signs an access token carrying {@link accessTokenClaims}.
 *
 * Takes the session row rather than its id because `jwt.claims` may be a
 * function, and that function is given both halves of what the token is for.
 */
export async function mintAccessToken(
  internals: AuthInternals,
  user: AuthUser,
  session: AuthSession
) {
  const { config } = internals
  const { signingKey, kid } = await internals.keys()
  const claims =
    typeof config.jwt.claims === "function"
      ? requireOwnedClaimsAbsent(await config.jwt.claims(user, session))
      : config.jwt.claims

  return signToken(
    {
      signingKey,
      algorithm: config.jwt.alg,
      kid,
      ttl: config.jwt.ttl,
      claims,
      ...(config.issuer ? { issuer: config.issuer } : {}),
      ...(config.jwt.audience ? { audience: config.jwt.audience } : {})
    },
    accessTokenClaims(user, session)
  )
}
