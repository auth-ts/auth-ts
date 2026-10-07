import type { TokenResult } from "../../endpoints/token"
import { AuthError } from "../lib/auth-error"
import type { FetchJson } from "../lib/fetch-json"
import { createFetchJson } from "../lib/fetch-json"
import type { LeveledLogger } from "../lib/logger"
import { createLogger } from "../lib/logger"
import type { SessionStore } from "../lib/session-storage"
import { createSessionStore } from "../lib/session-storage"
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
  sessionStore: SessionStore | undefined
  exchangeSession: (token: string) => Promise<TokenResult | null>
  attempts: Partial<
    Record<
      "signIn" | "identity" | "emailChange" | "phoneChange",
      { token: string; expiresAt: number; sessionId?: string }
    >
  >
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
  const sessionStore = config.sessionStorage
    ? createSessionStore(config.sessionStorage, config.baseURL, config.basePath)
    : undefined

  const fetchJson = createFetchJson(
    config,
    () => internals.locale,
    () => tokenStore.get()?.token,
    () => internals.requireToken(),
    () => tokenStore.clear(),
    () => tokenStore.generation()
  )

  const internals: AuthClientInternals = {
    config,
    tokenStore,
    fetchJson,
    requireToken: () => {
      throw new Error("requireToken not wired: use createAuthClient")
    },
    sessionStore,
    exchangeSession: async (bearer) => {
      try {
        return await fetchJson({
          method: "POST",
          path: "/token",
          body: {},
          bearer
        })
      } catch (error) {
        if (error instanceof AuthError && error.code === "unauthenticated")
          return null
        throw error
      }
    },
    attempts: {},
    log,
    locale: config.locale
  }

  return internals
}
