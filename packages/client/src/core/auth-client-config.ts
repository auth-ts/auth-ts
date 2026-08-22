import type { Logger, LogLevel } from "../lib/logger.ts"
import type { AuthClientOptions } from "./auth-client-options.ts"

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
  logLevel: LogLevel
  logger?: Logger
}

/** Applies defaults. Performs no input/output — constructing a client is free. */
export function resolveAuthClientConfig(
  options: AuthClientOptions = {}
): AuthClientConfig {
  const basePath = options.basePath ?? "/api/auth"

  return {
    basePath: basePath.startsWith("/")
      ? basePath.replace(/\/+$/, "")
      : `/${basePath}`,
    baseURL: options.baseURL?.replace(/\/+$/, "") ?? "",
    ...(options.locale ? { locale: options.locale } : {}),
    logLevel: options.logLevel ?? "error",
    ...(options.logger ? { logger: options.logger } : {})
  }
}
