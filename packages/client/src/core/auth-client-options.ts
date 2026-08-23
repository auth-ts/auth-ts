import type { CookieStorage } from "../lib/cookie-jar"
import type { Logger, LogLevel } from "../lib/logger"

// The shape `createAuthClient` accepts — and nothing else. Options are the
// partial input; what they resolve to is `AuthClientConfig`, in
// `auth-client-config.ts`. Same split as the server, for the same reason.

/** Options accepted by `createAuthClient`. Everything is optional. */
export interface AuthClientOptions {
  /** Where the auth server is mounted. Must match the server's `basePath`. @default "/api/auth" */
  basePath?: string
  /**
   * Absolute origin of the auth server, when it is not this one.
   *
   * Only works within the same registrable domain: the refresh cookie is
   * `SameSite=Lax`, so a genuinely foreign domain never receives it no matter
   * what CORS says. For a separate domain, reverse-proxy the auth mount under
   * this origin instead.
   *
   * Setting this also costs a signed-out visitor one request per page load: the
   * cookie that would have told this client not to bother is written by the
   * auth server, and only reaches a sibling host when the browser accepts the
   * domain the two share. Same-origin needs no such luck.
   */
  baseURL?: string
  /**
   * Initial locale, sent as `Accept-Language` on auth requests.
   *
   * Setting it replaces the browser's own header, which is how an application's
   * language setting comes to outrank the browser's — no precedence rule needed,
   * it falls out of the mechanism.
   */
  locale?: string
  /**
   * Where to keep the auth cookies, for a runtime with no cookie jar of its own.
   *
   * A browser holds the refresh cookie itself and never shows it to
   * JavaScript, so leave this unset there. A native app has no such jar: pass
   * a storage the platform protects — the keychain or keystore — and the
   * client keeps whatever the server sets and sends it back as the `Cookie`
   * header on every auth request, with `credentials: "omit"`. The server is
   * none the wiser, and the refresh token still travels nowhere else.
   */
  cookieStorage?: CookieStorage
  /** @default "error" — quiet in other people's consoles. */
  logLevel?: LogLevel
  /** Log sink override. Defaults to `console`. */
  logger?: Logger
}
