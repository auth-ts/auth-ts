import { requireOwnedClaimsAbsent } from "../core/auth-config"
import type { AuthSession, AuthUser } from "../core/auth-database"
import type { AuthInternals } from "../core/auth-internals"
import { signToken } from "../jwt/sign-token"
import { toHex } from "../lib/hash"
import { insertRow } from "../lib/insert-row"
import { clearCookie, shouldUseSecureCookies } from "../lib/serialize-cookie"
import { sweepExpired } from "../lib/sweep-expired"
import { bytesToBase64 } from "../shared/base64url"
import { presentedSessions } from "./presented-sessions"
import type { ResolvedSession } from "./resolve-session"
import { refreshCookieName, refreshCookies } from "./session-cookies"
import { sessionAge, sessionStamp } from "./session-token"

/** What issuing a session produced. */
export interface IssueResult {
  token: string
  user: AuthUser
  session: AuthSession
  /** `Set-Cookie` headers the caller must send. */
  headers: Headers
}

/** Everything issuing needs from the request. */
export interface IssueSessionInput {
  user: AuthUser
  headers: Headers
  /** How identity was proved, as RFC 8176 references. */
  amr: string[]
  /** Decides whether cookies carry `Secure`. */
  requestURL?: string
  /** The caller's session; a guest's is deleted. */
  caller?: ResolvedSession | null
}

/** Creates a session and mints its access token. */
export async function issueSession(
  internals: AuthInternals,
  { user, headers, requestURL, caller, amr }: IssueSessionInput
): Promise<IssueResult> {
  const { config } = internals
  const secret = new Uint8Array(32)
  crypto.getRandomValues(secret)
  const secretHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", secret)
  )

  // Retire sessions this cookie write orphans
  const [session, , held] = await Promise.all([
    insertRow(internals, "sessions", {
      userId: user.id,
      secretHash: toHex(secretHash),
      amr,
      ...sessionStamp(internals, headers)
    }),
    sweepExpired(internals, "sessions", sessionAge(internals).stale),
    presentedSessions(internals, headers, {
      live: false,
      read: config.multiUser
    })
  ])
  const rawToken = `${session.id}.${bytesToBase64(secret)}`
  const stranded = held.filter(
    ({ session }) => !config.multiUser || session?.userId === user.id
  )
  const superseded = new Map(
    stranded.flatMap(({ credential }) =>
      credential ? [[credential.id, toHex(credential.secretHash)] as const] : []
    )
  )
  if (caller?.user.type === "guest") {
    superseded.set(caller.session.id, caller.session.secretHash)
  }
  // Only after the replacement exists
  superseded.delete(session.id)

  const [token] = await Promise.all([
    mintAccessToken(internals, user, session),
    ...[...superseded].map(([id, secretHash]) =>
      internals.db.delete({
        table: "sessions",
        where: { id: { eq: id }, secretHash: { eq: secretHash } }
      })
    )
  ])
  if (superseded.size > 0) internals.log.debug("superseded sessions deleted")

  const responseHeaders = new Headers()
  internals.log.debug("session issued", { userType: user.type })

  const secure = shouldUseSecureCookies(requestURL)
  for (const { userId } of stranded) {
    if (userId === user.id) continue
    responseHeaders.append(
      "set-cookie",
      clearCookie(refreshCookieName(config, userId), config.cookie.path, secure)
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

  return { token, user, session, headers: responseHeaders }
}

// No name or address: tokens get logged
function accessTokenClaims(user: AuthUser, session: AuthSession) {
  return {
    userId: user.id,
    type: user.type,
    sid: session.id,
    ...(session.amr?.length ? { amr: session.amr } : {})
  }
}

/** Signs an access token for a user's session. */
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
