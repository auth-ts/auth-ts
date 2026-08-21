import type { Duration } from "./parse-duration.ts"
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
/** Builds a `Set-Cookie` value with this library's fixed security attributes. */
export declare function serializeCookie(cookie: CookieAttributes): string
/**
 * Builds a `Set-Cookie` value that deletes a cookie.
 *
 * The path must match the one it was set with, or the browser keeps the original
 * and the user stays signed in after clicking sign out.
 */
export declare function clearCookie(
  name: string,
  path: string,
  secure?: boolean
): string
/**
 * Decides whether cookies should carry `Secure` for this request.
 *
 * `Secure` cookies are dropped by browsers over plain HTTP, which would break
 * `http://localhost` development entirely — so it is relaxed there and nowhere else.
 */
export declare function shouldUseSecureCookies(requestURL: string): boolean
//# sourceMappingURL=serialize-cookie.d.ts.map
