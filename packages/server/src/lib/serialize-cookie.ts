import type { Duration } from "./parse-duration"
import { parseDurationSeconds } from "./parse-duration"

/**
 * The cookie attributes this library controls.
 *
 * Only `name`, `value`, `path`, and lifetime are caller-supplied. `HttpOnly`,
 * `Secure`, and `SameSite=Lax` are not configurable: every cookie built here
 * carries a session credential, and making those optional would turn a typo
 * into an XSS or CSRF exposure. There is no `Domain` option either — these
 * cookies stay host-only so the token is never broadcast to sibling subdomains.
 *
 * The one cookie that is none of those things has its own builder,
 * {@link serializeHintCookie}, and says why it may be read by script.
 */
export interface CookieAttributes {
  /** Cookie name, e.g. `"auth-ts.refresh"`. */
  name: string
  /** Raw cookie value; percent-encoded on the way out. */
  value: string
  /** `Path` attribute — the auth mount by default. */
  path: string
  /** Lifetime as a duration; omit for a session cookie. */
  maxAge?: Duration
  /**
   * Set `false` only for plain-HTTP localhost development. Production always
   * sends `Secure`; the resolver decides this from the request URL, not the caller.
   */
  secure?: boolean
}

function serializeAttributes(
  path: string,
  secure: boolean,
  maxAgeSeconds?: number
) {
  const attributes = [`Path=${path}`, "HttpOnly", "SameSite=Lax"]
  if (secure) attributes.push("Secure")
  if (maxAgeSeconds !== undefined) attributes.push(`Max-Age=${maxAgeSeconds}`)
  return attributes.join("; ")
}

/** Builds a `Set-Cookie` value with this library's fixed security attributes. */
export function serializeCookie(cookie: CookieAttributes) {
  const maxAgeSeconds =
    cookie.maxAge === undefined
      ? undefined
      : parseDurationSeconds(cookie.maxAge)
  const encodedValue = encodeURIComponent(cookie.value)
  const attributes = serializeAttributes(
    cookie.path,
    cookie.secure ?? true,
    maxAgeSeconds
  )

  return `${cookie.name}=${encodedValue}; ${attributes}`
}

/** The cookie that tells a browser client whether asking for a token is worth a request. */
export const HINT_COOKIE_NAME = "auth-ts.hint"

/**
 * What the hint says: the active user's id, or `"out"` for demonstrably nobody.
 *
 * Carrying the id rather than `"in"` is what lets a browser know *which*
 * refresh cookie to spend without reading every one of them, and lets a
 * server-rendered page know who to render as before it resolves anything.
 *
 * `"out"` is only written where the hint may be delivered cross-origin, since
 * that is the only deployment where a missing hint is ambiguous.
 */
export type HintValue = string

/** Where a hint cookie applies, which is all that setting and clearing it share. */
export interface HintCookieScope {
  /** Same rule as every other cookie here — see {@link shouldUseSecureCookies}. */
  secure?: boolean
  /** Set only for a cross-origin deployment, where the app is on a sibling host. */
  domain?: string
}

/** Attributes of the hint cookie that vary per response. */
export interface HintCookieAttributes extends HintCookieScope {
  value: HintValue
  /** Lifetime as a duration, matching the refresh cookie it shadows. */
  maxAge: Duration
}

/**
 * Builds the hint cookie.
 *
 * The one cookie in this library that script may read and that may carry a
 * `Domain`, because it is the one cookie that is not a credential: its entire
 * contents are a user id or `out`. It exists so a signed-out visitor costs no
 * request, which means a browser has to be able to read it, and a cross-origin
 * app has to be able to receive it. The refresh tokens stay `HttpOnly` and
 * host-only, and learning that a browser once signed in is not a capability —
 * whoever can read this can already see the interface it produces. A script
 * that rewrites it only chooses which already-held cookie the server spends,
 * which is what `POST /users/switch` offers it anyway.
 *
 * `Path` is always `/`, never `cookie.path`: `document.cookie` only exposes
 * cookies whose path covers the current page, and a hint scoped to the auth
 * mount would be invisible on every page that needs it.
 */
export function serializeHintCookie(cookie: HintCookieAttributes) {
  return hintCookie(cookie.value, cookie, parseDurationSeconds(cookie.maxAge))
}

/** Builds a `Set-Cookie` value that deletes the hint cookie. */
export function clearHintCookie(options: HintCookieScope = {}) {
  return hintCookie("", options, 0)
}

function hintCookie(
  value: string,
  { secure, domain }: HintCookieScope,
  maxAgeSeconds: number
) {
  const attributes = ["Path=/", "SameSite=Lax"]
  if (secure ?? true) attributes.push("Secure")
  if (domain) attributes.push(`Domain=${domain}`)
  attributes.push(`Max-Age=${maxAgeSeconds}`)

  return `${HINT_COOKIE_NAME}=${encodeURIComponent(value)}; ${attributes.join("; ")}`
}

/**
 * Builds a `Set-Cookie` value that deletes a cookie.
 *
 * The path must match the one it was set with, or the browser keeps the original
 * and the user stays signed in after clicking sign out.
 */
export function clearCookie(name: string, path: string, secure = true) {
  return `${name}=; ${serializeAttributes(path, secure, 0)}`
}

/**
 * Decides whether cookies should carry `Secure` for this request.
 *
 * `Secure` cookies are dropped by browsers over plain HTTP, which would break
 * `http://localhost` development entirely — so it is relaxed there and nowhere
 * else.
 *
 * No URL at all means an endpoint called in-process rather than over HTTP,
 * where there is no request to inspect and no browser waiting. That answers
 * `true`: the only reason to omit `Secure` is a local development origin, and
 * something that cannot be observed to be one is not one. Guessing the other
 * way would put a session credential on the wire.
 */
export function shouldUseSecureCookies(requestURL?: string) {
  if (!requestURL) return true

  const { protocol, hostname } = new URL(requestURL)
  if (protocol === "https:") return true

  return (
    hostname !== "localhost" &&
    hostname !== "127.0.0.1" &&
    hostname !== "[::1]" &&
    hostname !== "::1"
  )
}
