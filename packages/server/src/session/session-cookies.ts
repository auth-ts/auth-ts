import type { AuthServerConfig } from "../core/auth-server-config"
import type { AuthServerInternals } from "../core/auth-server-internals"
import { parseCookies } from "../lib/parse-cookies"
import {
  clearCookie,
  clearHintCookie,
  serializeCookie,
  serializeHintCookie,
  shouldUseSecureCookies
} from "../lib/serialize-cookie"

/** What writing the session cookies needs from the request, when there is one. */
export interface SessionCookieContext {
  /** Read to decide whether cookies carry `Secure`. */
  requestURL?: string
  /** Read for the refresh cookies this browser presented. */
  headers?: Headers
}

/**
 * The cookie one user's refresh token lives in.
 *
 * One cookie per user rather than a list packed into one: the browser cannot
 * read any of them, so the alternative is a parked-token array with its own
 * park, prune, promote, and demote helpers — and a hard ceiling, since a single
 * cookie stops at 4096 bytes. Separate cookies share no such budget.
 */
export function refreshCookieName(config: AuthServerConfig, userId: string) {
  return `${config.cookie.name}.${userId}`
}

/** Every refresh token this browser presented, by the user it belongs to. */
export function readRefreshCookies(
  internals: AuthServerInternals,
  headers: Headers
) {
  const prefix = `${internals.config.cookie.name}.`
  const tokens = new Map<string, string>()

  for (const [name, value] of parseCookies(headers.get("cookie"))) {
    if (!name.startsWith(prefix) || !value) continue
    const userId = name.slice(prefix.length)
    if (userId) tokens.set(userId, value)
  }

  return tokens
}

/**
 * The domain the hint cookie is scoped to, or `undefined` for host-only.
 *
 * Configuration, not derivation. Working it out from the request means guessing
 * where the registrable domain ends, and a guess that lands on a public suffix
 * — `vercel.app`, `github.io` — is refused by the browser rather than here, so
 * the hint silently never arrives. A stated domain is either right or visibly
 * wrong.
 */
export function hintCookieDomain(internals: AuthServerInternals) {
  return internals.config.cookie.hintDomain
}

/**
 * The `Set-Cookie` values that put a browser on one user's session.
 *
 * The refresh cookie and the hint are written together, because a browser
 * holding one without the other is exactly the state both sides read wrongly: a
 * hint with no session costs a pointless request, and a session with no hint
 * reads as signed out. The hint names this user, so it doubles as which of
 * several refresh cookies to spend.
 */
export function refreshCookies(
  internals: AuthServerInternals,
  {
    rawToken,
    userId,
    requestURL
  }: SessionCookieContext & { rawToken: string; userId: string }
) {
  const { config } = internals
  const secure = shouldUseSecureCookies(requestURL)
  const maxAge = config.session.ttl

  return [
    serializeCookie({
      name: refreshCookieName(config, userId),
      value: rawToken,
      path: config.cookie.path,
      maxAge,
      secure
    }),
    serializeHintCookie({
      value: userId,
      maxAge,
      secure,
      domain: hintCookieDomain(internals)
    })
  ]
}

/**
 * The `Set-Cookie` values that retire one user's session, or every one of them.
 *
 * `userId` retires that user alone and points the hint at whoever is left,
 * because signing one user out of a shared browser must not sign out the rest.
 * Omitting it retires everything this browser presented.
 *
 * With `cookie.hintDomain` set the hint is written `out` rather than cleared. A
 * cross-subdomain deployment cannot tell a hint that was never delivered from
 * one that says no, so it treats a missing hint as "ask" — and only an explicit
 * `out` buys the silence this exists for.
 */
export function clearedRefreshCookies(
  internals: AuthServerInternals,
  { requestURL, headers, userId }: SessionCookieContext & { userId?: string }
) {
  const { config } = internals
  const secure = shouldUseSecureCookies(requestURL)
  const domain = hintCookieDomain(internals)

  const presented = headers
    ? readRefreshCookies(internals, headers)
    : new Map<string, string>()
  const retiring = userId === undefined ? [...presented.keys()] : [userId]
  const cookies = retiring.map((id) =>
    clearCookie(refreshCookieName(config, id), config.cookie.path, secure)
  )

  // Whoever is still signed in here takes the hint; only an empty browser
  // retires it. Order is the cookie header's, which is not meaningful — any
  // survivor is a correct answer, and the next `/token` confirms it.
  const remaining = [...presented.keys()].filter((id) => !retiring.includes(id))
  const survivor = remaining[0]
  cookies.push(
    survivor !== undefined
      ? serializeHintCookie({
          value: survivor,
          maxAge: config.session.ttl,
          secure,
          domain
        })
      : config.cookie.hintDomain
        ? serializeHintCookie({
            value: "out",
            maxAge: config.session.ttl,
            secure,
            domain
          })
        : clearHintCookie({ secure, domain })
  )

  return cookies
}
