import type { Logger, LogLevel } from "../lib/logger.ts"

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
  /** @default "error" — quiet in other people's consoles. */
  logLevel?: LogLevel
  /** Log sink override. Defaults to `console`. */
  logger?: Logger
}
