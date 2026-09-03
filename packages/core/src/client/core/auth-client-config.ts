import { normalizeBasePath } from "../../shared/base-path"
import type { CookieStorage } from "../lib/cookie-jar"
import type { Logger, LogLevel } from "../lib/logger"
import type { AuthClientOptions } from "./auth-client-options"

/**
 * The configuration the client runs on: {@link AuthClientOptions} after
 * defaults.
 *
 * Options are what you pass; this is what resolving them produces. Every field
 * that is optional here is optional because it is genuinely absent — no locale,
 * no custom sink — never because a default is still pending.
 */
export interface AuthClientConfig {
  basePath: string
  baseURL: string
  locale?: string
  cookieStorage?: CookieStorage
  logLevel: LogLevel
  logger?: Logger
}

/** Applies defaults. */
export function resolveAuthClientConfig(
  options: AuthClientOptions = {}
): AuthClientConfig {
  return {
    basePath: normalizeBasePath(options.basePath ?? "/api/auth"),
    baseURL: options.baseURL?.replace(/\/+$/, "") ?? "",
    ...(options.locale ? { locale: options.locale } : {}),
    ...(options.cookieStorage ? { cookieStorage: options.cookieStorage } : {}),
    logLevel: options.logLevel ?? "error",
    ...(options.logger ? { logger: options.logger } : {})
  }
}
