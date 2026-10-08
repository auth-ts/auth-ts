import { normalizeBasePath } from "../../shared/base-path"
import type { Logger, LogLevel } from "../lib/logger"
import type { SessionStorage } from "../lib/session-storage"
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
  sessionStorage?: SessionStorage
  logLevel: LogLevel
  logger?: Logger
}

/** Applies defaults. */
export function resolveAuthClientConfig(
  options: AuthClientOptions = {}
): AuthClientConfig {
  if (options.sessionStorage) {
    let url: URL
    try {
      url = new URL(options.baseURL ?? "")
    } catch {
      throw new Error("sessionStorage requires an absolute baseURL.")
    }
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        ))
    ) {
      throw new Error(
        "sessionStorage requires an HTTPS origin or HTTP loopback origin."
      )
    }
  }
  return {
    basePath: normalizeBasePath(options.basePath ?? "/api/auth"),
    baseURL: options.baseURL?.replace(/\/+$/, "") ?? "",
    ...(options.locale ? { locale: options.locale } : {}),
    ...(options.sessionStorage
      ? { sessionStorage: options.sessionStorage }
      : {}),
    logLevel: options.logLevel ?? "error",
    ...(options.logger ? { logger: options.logger } : {})
  }
}
