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

/**
 * The shared state every client method is built on.
 *
 * The mirror of the server's struct, and a struct for the same mundane reason:
 * each method needs the same five things, and passing one object beats threading
 * five parameters through every function.
 */
export interface AuthClientInternals {
  /** The resolved configuration — options after defaults. */
  config: AuthClientConfig
  tokenStore: TokenStore
  fetchJson: FetchJson
  /**
   * Returns a live access token, refreshing through `/token` when needed.
   *
   * Assigned by `createAuthClient`, which is where the refresh is built. It has
   * to be late-bound because the refresh issues a request and so needs
   * `fetchJson`, which needs this — one of the two has to be filled in after.
   */
  getToken: () => Promise<string>
  /** The client's own cookie jar, where `cookieStorage` stands in for a browser's. */
  cookieJar: CookieJar | undefined
  log: LeveledLogger
  /** The current locale, which `setLocale` replaces at runtime. */
  locale: string | undefined
}

/** Builds the internals. Performs no network work and touches no storage. */
export function createAuthClientInternals(
  options: AuthClientOptions = {}
): AuthClientInternals {
  const config = resolveAuthClientConfig(options)

  const tokenStore = createTokenStore()

  const internals: AuthClientInternals = {
    config,
    tokenStore,
    fetchJson: undefined as unknown as FetchJson,
    getToken: undefined as unknown as () => Promise<string>,
    cookieJar: config.cookieStorage
      ? createCookieJar(config.cookieStorage)
      : undefined,
    log: createLogger(config.logLevel, config.logger),
    locale: config.locale
  }

  // Reads `internals.locale` on each request, so setLocale takes effect
  // immediately rather than only for clients constructed afterwards.
  internals.fetchJson = createFetchJson(
    internals.cookieJar,
    config,
    () => internals.locale,
    // Sent even when it is close to expiry: the server reads it to know which
    // session this browser thinks it is on — which is what lets a verification
    // code upgrade the right guest — and nothing here depends on withholding it.
    () => tokenStore.get()?.token,
    () => internals.getToken(),
    () => tokenStore.clear()
  )

  return internals
}
