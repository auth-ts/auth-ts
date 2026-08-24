import type { AuthServerInternals } from "../core/auth-server-internals"
import { AuthConfigError } from "../http/auth-config-error"
import { getBaseURL } from "../lib/get-base-url"
import {
  clearCookie,
  clearHintCookie,
  serializeCookie,
  serializeHintCookie,
  shouldUseSecureCookies
} from "../lib/serialize-cookie"

/** What writing the session cookies needs from the request, when there is one. */
export interface SessionCookieContext {
  /** Read to decide `Secure` and to derive the hint's `Domain`. */
  requestURL?: string
  /** Read for `X-Forwarded-Host`, so a proxied server names its public host. */
  headers?: Headers
}

/**
 * The domain the hint cookie is scoped to, or `undefined` for host-only.
 *
 * Only a trusted origin on another host produces one. It is taken from the
 * request rather than the configuration because `trustedOrigins` may name
 * several, and the one asking is the one whose host has to be able to read the
 * hint. A host-only hint would be written on the auth host and never seen there.
 *
 * The domain is the longest suffix of labels the two hosts share. A suffix that
 * is a public suffix — `vercel.app`, `github.io` — is rejected by the browser
 * rather than by this function; the hint then never arrives, which a
 * cross-origin client already treats as "ask the server".
 */
export function hintCookieDomain(
  internals: AuthServerInternals,
  { requestURL, headers }: SessionCookieContext
) {
  const origin = headers?.get("origin")
  if (!origin || !internals.config.trustedOrigins.includes(origin)) {
    return undefined
  }

  let serverHost: string
  let appHost: string
  try {
    serverHost = new URL(getBaseURL(internals.config, requestURL, headers))
      .hostname
    appHost = new URL(origin).hostname
  } catch (error) {
    // An origin this server cannot parse is a configuration problem for the
    // endpoints that build URLs from it to report, not for a cookie to throw on.
    if (error instanceof AuthConfigError) return undefined
    throw error
  }

  if (serverHost === appHost) return undefined

  const serverLabels = serverHost.split(".")
  const appLabels = appHost.split(".")
  const shared: string[] = []
  for (
    let at = 1;
    at <= Math.min(serverLabels.length, appLabels.length);
    at++
  ) {
    const label = serverLabels[serverLabels.length - at]
    if (label !== appLabels[appLabels.length - at]) break
    shared.unshift(label as string)
  }

  // A single shared label is a TLD, which no browser accepts as a domain.
  return shared.length > 1 ? shared.join(".") : undefined
}

/**
 * The `Set-Cookie` values that put a browser on a session.
 *
 * The refresh cookie and the hint are written together and expire together,
 * because a browser holding one without the other is exactly the state both
 * sides read wrongly: a hint with no session costs a pointless request, and a
 * session with no hint reads as signed out.
 */
export function refreshCookies(
  internals: AuthServerInternals,
  { rawToken, requestURL, headers }: SessionCookieContext & { rawToken: string }
) {
  const { config } = internals
  const secure = shouldUseSecureCookies(requestURL)
  const maxAge = config.session.ttl

  return [
    serializeCookie({
      name: config.cookie.name,
      value: rawToken,
      path: config.cookie.path,
      maxAge,
      secure
    }),
    serializeHintCookie({
      value: "in",
      maxAge,
      secure,
      domain: hintCookieDomain(internals, { requestURL, headers })
    })
  ]
}

/**
 * The `Set-Cookie` values that retire a session.
 *
 * With `trustedOrigins` set the hint is written `out` rather than cleared. A
 * cross-origin deployment cannot tell a hint that was never delivered from one
 * that says no,
 * so it treats a missing hint as "ask" — and only an explicit `out` buys the
 * silence this exists for.
 */
export function clearedRefreshCookies(
  internals: AuthServerInternals,
  { requestURL, headers }: SessionCookieContext
) {
  const { config } = internals
  const secure = shouldUseSecureCookies(requestURL)
  const domain = hintCookieDomain(internals, { requestURL, headers })

  return [
    clearCookie(config.cookie.name, config.cookie.path, secure),
    config.trustedOrigins.length > 0
      ? serializeHintCookie({
          value: "out",
          maxAge: config.session.ttl,
          secure,
          domain
        })
      : clearHintCookie({ secure, domain })
  ]
}
