import type { Logger, LogLevel } from "../lib/logger"
import type { SessionStorage } from "../lib/session-storage"

/** Options accepted by `createAuthClient`. */
export interface AuthClientOptions {
  /**
   * Where the auth server is mounted. Match the server's `basePath`.
   * @default "/api/auth"
   */
  basePath?: string
  /** Browser cookies require the same registrable domain. */
  baseURL?: string
  /** Sent as `Accept-Language`, replacing the browser's. */
  locale?: string
  /** Use native secure storage; omit in browsers. */
  sessionStorage?: SessionStorage
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
