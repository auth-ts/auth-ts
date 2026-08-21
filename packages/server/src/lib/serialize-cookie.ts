import type { Duration } from "./parse-duration.ts"
import { parseDurationSeconds } from "./parse-duration.ts"

/**
 * The cookie attributes this library controls.
 *
 * Only `name`, `value`, `path`, and lifetime are caller-supplied. `HttpOnly`,
 * `Secure`, and `SameSite=Lax` are not configurable: every cookie here carries a
 * session credential, and making those optional would turn a typo into an XSS or
 * CSRF exposure. There is no `Domain` option either — cookies stay host-only so
 * the token is never broadcast to sibling subdomains.
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
 * `http://localhost` development entirely — so it is relaxed there and nowhere else.
 */
export function shouldUseSecureCookies(requestURL: string) {
  const { protocol, hostname } = new URL(requestURL)
  if (protocol === "https:") return true

  return (
    hostname !== "localhost" &&
    hostname !== "127.0.0.1" &&
    hostname !== "[::1]" &&
    hostname !== "::1"
  )
}
