import type { CookieJar } from "../lib/cookie-jar"
import { createCookieJar } from "../lib/cookie-jar"
import type { FetchJson } from "../lib/fetch-json"
import { createFetchJson } from "../lib/fetch-json"
import type { LeveledLogger } from "../lib/logger"
import { createLogger } from "../lib/logger"
import type { AuthClientConfig } from "./auth-client-config"
import { resolveAuthClientConfig } from "./auth-client-config"
import type { AuthClientOptions } from "./auth-client-options"
import type { TokenStore } from "./token-store"
import { createTokenStore } from "./token-store"

/** The shared state every client method is built on. */
export interface AuthClientInternals {
  /** The resolved configuration — options after defaults. */
  config: AuthClientConfig
  tokenStore: TokenStore
  fetchJson: FetchJson
  /**
   * A live access token, or the server's `unauthenticated` error.
   *
   * Assigned by `createAuthClient`, which is where the refresh is built. It has
   * to be late-bound because the refresh issues a request and so needs
   * `fetchJson`, which needs this — one of the two has to be filled in after.
   */
  requireToken: () => Promise<string>
  /** The client's own cookie jar, where `cookieStorage` stands in for a browser's. */
  cookieJar: CookieJar | undefined
  log: LeveledLogger
  /** The current locale, which `setLocale` replaces at runtime. */
  locale: string | undefined
}

/** Builds the internals. */
export function createAuthClientInternals(
  options: AuthClientOptions = {}
): AuthClientInternals {
  const config = resolveAuthClientConfig(options)
  const log = createLogger(config.logLevel, config.logger)
  const tokenStore = createTokenStore(log)
  const cookieJar = config.cookieStorage
    ? createCookieJar(config.cookieStorage)
    : undefined

  // Reads `internals.locale` on each request, so setLocale takes effect
  // immediately rather than only for clients constructed afterwards.
  const fetchJson = createFetchJson(
    cookieJar,
    config,
    () => internals.locale,
    // Sent even when it is close to expiry: the server reads it to know which
    // session this browser thinks it is on — which is what lets a verification
    // code upgrade the right guest — and nothing here depends on withholding it.
    () => tokenStore.get()?.token,
    () => internals.requireToken(),
    () => tokenStore.clear()
  )

  const internals: AuthClientInternals = {
    config,
    tokenStore,
    fetchJson,
    requireToken: () => {
      throw new Error("requireToken not wired: use createAuthClient")
    },
    cookieJar,
    log,
    locale: config.locale
  }

  return internals
}
