import type { CookieStorage } from "../lib/cookie-jar"
import type { Logger, LogLevel } from "../lib/logger"

/** Options accepted by `createAuthClient`. */
export interface AuthClientOptions {
  /**
   * Where the auth server is mounted. Match the server's `basePath`.
   * @default "/api/auth"
   */
  basePath?: string
  /** The auth server's origin, when not this one. Same registrable domain only. */
  baseURL?: string
  /** Sent as `Accept-Language`, replacing the browser's. */
  locale?: string
  /** Cookie storage for native apps. Leave unset in browsers. */
  cookieStorage?: CookieStorage
  /**
   * Minimum level logged.
   * @default "error"
   */
  logLevel?: LogLevel
  /**
   * Log sink.
   * @default console
   */
  logger?: Logger
}
