import { readLifetimeClaims } from "../lib/read-lifetime-claims"

/** The in-memory access token and what is known about its lifetime. */
export interface TokenState {
  token: string
  /** `iat` from the token, in milliseconds. */
  issuedAt: number
  /** `exp` from the token, in milliseconds. */
  expiresAt: number
  /** When this client received it, by the local clock. */
  receivedAt: number
}

/**
 * Refresh this many milliseconds before the token actually expires.
 *
 * Fixed rather than configurable: longer just refreshes more often for no
 * benefit, and shorter reintroduces the bug the buffer exists to prevent — a
 * token that passes the check, then expires while the request carrying it is
 * still in flight.
 */
export const REFRESH_AHEAD_MS = 60_000

/**
 * How close to expiry a caller has to wait for the new token.
 *
 * Between this and {@link REFRESH_AHEAD_MS} the cached token is handed back and
 * the refresh runs behind it, so a page that already holds a usable token never
 * blocks on the network. Below it there may not be enough life left to survive
 * the request being made, which is the failure the buffer exists to prevent.
 */
export const REFRESH_BLOCKING_MS = 10_000

/** Holds the access token in memory and answers whether it still has life in it. */
export interface TokenStore {
  get(): TokenState | null
  /** Stores a token, reading its own lifetime claims to know when to refresh. */
  set(token: string): void
  clear(): void
  /** True when there is no token, or it is inside the refresh-ahead window. */
  isExpiringSoon(): boolean
  /** Too close to expiry to hand out while a refresh runs behind it. */
  mustRefresh(): boolean
  /** Runs `refresh` once even if called concurrently, sharing the one result. */
  singleFlight<Result>(refresh: () => Promise<Result>): Promise<Result>
}

/**
 * Creates the token store.
 *
 * The token lives in a closure variable and nowhere else — never
 * `localStorage`, never `sessionStorage`. A persisted bearer token turns any
 * cross-site scripting flaw into a credential an attacker can exfiltrate and
 * keep using after the tab is closed; in memory, it dies with the page.
 */
export function createTokenStore(): TokenStore {
  let state: TokenState | null = null
  let inFlight: Promise<unknown> | null = null

  return {
    get: () => state,

    set(token) {
      const claims = readLifetimeClaims(token)
      const now = Date.now()
      const issuedAt = typeof claims.iat === "number" ? claims.iat * 1000 : now
      const expiresAt = typeof claims.exp === "number" ? claims.exp * 1000 : now

      state = { token, issuedAt, expiresAt, receivedAt: now }
    },

    clear() {
      state = null
    },

    isExpiringSoon() {
      if (!state) return true

      // Measured as the token's own lifetime against time elapsed here, rather
      // than comparing `exp` to the local clock: a device whose clock is wrong by
      // hours would otherwise either refresh on every call or never refresh at all.
      const lifetime = state.expiresAt - state.issuedAt
      const elapsed = Date.now() - state.receivedAt

      return elapsed >= lifetime - REFRESH_AHEAD_MS
    },

    mustRefresh() {
      if (!state) return true

      const lifetime = state.expiresAt - state.issuedAt

      return Date.now() - state.receivedAt >= lifetime - REFRESH_BLOCKING_MS
    },

    async singleFlight<Result>(refresh: () => Promise<Result>) {
      // Ten components mounting at once should cost one request, not ten — and
      // more importantly should not produce ten different answers.
      inFlight ??= refresh().finally(() => {
        inFlight = null
      })

      return inFlight as Promise<Result>
    }
  }
}
