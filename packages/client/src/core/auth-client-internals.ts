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
    log: createLogger(config.logLevel, config.logger),
    locale: config.locale
  }

  // Reads `internals.locale` on each request, so setLocale takes effect
  // immediately rather than only for clients constructed afterwards.
  internals.fetchJson = createFetchJson(
    config,
    () => internals.locale,
    // Only while it is worth presenting: a token near expiry is the signal for
    // `/user` to mint a replacement, so sending it would suppress the refresh.
    () => {
      const held = tokenStore.get()

      return held && !tokenStore.isExpiringSoon() ? held.token : undefined
    }
  )

  return internals
}
