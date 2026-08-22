import type { FetchJson } from "../lib/fetch-json.ts"
import { createFetchJson } from "../lib/fetch-json.ts"
import type { LeveledLogger } from "../lib/logger.ts"
import { createLogger } from "../lib/logger.ts"
import type {
  AuthClientOptions,
  ResolvedAuthClientOptions
} from "./auth-client-options.ts"
import { resolveAuthClientOptions } from "./auth-client-options.ts"
import type { TokenStore } from "./token-store.ts"
import { createTokenStore } from "./token-store.ts"
import type { UserStore } from "./user-store.ts"
import { createUserStore } from "./user-store.ts"

/**
 * The shared state every client method is built on.
 *
 * The mirror of the server's struct, and a struct for the same mundane reason:
 * each method needs the same five things, and passing one object beats threading
 * five parameters through every function.
 */
export interface AuthClientInternals {
  options: ResolvedAuthClientOptions
  tokenStore: TokenStore
  userStore: UserStore
  fetchJson: FetchJson
  log: LeveledLogger
  /** The current locale, which `setLocale` replaces at runtime. */
  locale: string | undefined
}

/** Builds the internals. Performs no network work and touches no storage. */
export function createAuthClientInternals(
  options: AuthClientOptions = {}
): AuthClientInternals {
  const resolved = resolveAuthClientOptions(options)

  const tokenStore = createTokenStore()

  const internals: AuthClientInternals = {
    options: resolved,
    tokenStore,
    userStore: createUserStore(() => {
      tokenStore.clear()
    }),
    fetchJson: undefined as unknown as FetchJson,
    log: createLogger(resolved.logLevel, resolved.logger),
    locale: resolved.locale
  }

  // Reads `internals.locale` on each request, so setLocale takes effect
  // immediately rather than only for clients constructed afterwards.
  internals.fetchJson = createFetchJson(resolved, () => internals.locale)

  return internals
}
