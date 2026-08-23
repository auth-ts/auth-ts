import { decodeToken } from "../lib/decode-token"
import {
  createDeleteUser,
  createListSessions,
  createRevokeSession,
  createSignOut,
  createUpdateUser
} from "../methods/account"
import { createGetSession } from "../methods/get-session"
import type { GetTokenOptions } from "../methods/get-token"
import { createGetToken } from "../methods/get-token"
import { createGetUser } from "../methods/get-user"
import {
  createDisconnect,
  createGetProviderToken,
  createListAccounts,
  createListIdentities,
  createSwitchAccount
} from "../methods/identities-and-accounts"
import { createConnect, createSignInProvider } from "../methods/oauth"
import {
  createSendCode,
  createSignInCode,
  createSignInGuest
} from "../methods/sign-in-with-code"
import { createAuthClientInternals } from "./auth-client-internals"
import type { AuthClientOptions } from "./auth-client-options"

/**
 * The client.
 *
 * Two planes, one exchange: the refresh cookie buys an access token at
 * `/token`, and that token authenticates everything else — this client's own
 * methods and the data plane alike, so the same credential a PostgREST query
 * carries is the one a profile update carries. An application that never calls
 * `getToken` itself still gets all of this, because every method calls it. In a
 * browser the cookie is the browser's; anywhere else, `cookieStorage` is where
 * the client keeps it.
 */
export interface AuthClient {
  /**
   * A valid access token, refreshed when needed, or `null` when signed out.
   *
   * Hand it to your data client: Neon's `fetchWithToken` and its equivalents
   * take exactly this shape and raise their own error on `null`, so a
   * signed-out data query fails as a data-plane error rather than an auth one.
   *
   * A browser that has never signed in, or has signed out, answers `null`
   * without a request — so calling this on every render costs nothing until
   * there is something to refresh.
   */
  getToken: (options?: GetTokenOptions) => Promise<string | null>
  /** The user, the session, and a token — or `null`. Always reads the server. */
  getUser: ReturnType<typeof createGetUser>
  /** The session this browser is on, confirming it is live and keeping it that way. */
  getSession: ReturnType<typeof createGetSession>
  sendCode: ReturnType<typeof createSendCode>
  signInCode: ReturnType<typeof createSignInCode>
  signInGuest: ReturnType<typeof createSignInGuest>
  signInProvider: ReturnType<typeof createSignInProvider>
  connect: ReturnType<typeof createConnect>
  listIdentities: ReturnType<typeof createListIdentities>
  disconnect: ReturnType<typeof createDisconnect>
  getProviderToken: ReturnType<typeof createGetProviderToken>
  listSessions: ReturnType<typeof createListSessions>
  revokeSession: ReturnType<typeof createRevokeSession>
  listAccounts: ReturnType<typeof createListAccounts>
  switchAccount: ReturnType<typeof createSwitchAccount>
  updateUser: ReturnType<typeof createUpdateUser>
  deleteUser: ReturnType<typeof createDeleteUser>
  signOut: ReturnType<typeof createSignOut>
  /** Changes the locale sent on subsequent requests. */
  setLocale: (locale: string | undefined) => void
  /** Drops the in-memory token only — the 401-retry helper. Leaves the session alone. */
  clearToken: () => void
  /**
   * Reads a token's claims **without verifying it** — `sid` for which session
   * row is this device, `sub`, `exp`. The server's `decodeToken`, same rule:
   * never authorize with it.
   */
  decodeToken: typeof decodeToken
}

/**
 * Creates the auth client.
 *
 * Construction performs no network request and touches no storage, so importing
 * the module that calls it is free and safe during server-side rendering.
 * Everything reconciles on the first read: with no token in memory the first
 * authenticated call refreshes, which covers every boot case — a revoked
 * session resolves to `null`, a valid cookie with wiped storage signs the user
 * back in, and a signed-out visitor makes exactly one request.
 */
export function createAuthClient(options: AuthClientOptions = {}): AuthClient {
  const internals = createAuthClientInternals(options)

  const { getToken, requireToken, refresh } = createGetToken(internals)
  // Late-bound: the refresh issues a request, so it needs `fetchJson`, which in
  // turn needs to be able to refresh.
  internals.requireToken = requireToken

  return {
    getToken,
    getUser: createGetUser(internals, refresh),
    getSession: createGetSession(internals),
    sendCode: createSendCode(internals),
    signInCode: createSignInCode(internals),
    signInGuest: createSignInGuest(internals),
    signInProvider: createSignInProvider(internals),
    connect: createConnect(internals),
    listIdentities: createListIdentities(internals),
    disconnect: createDisconnect(internals),
    getProviderToken: createGetProviderToken(internals),
    listSessions: createListSessions(internals),
    revokeSession: createRevokeSession(internals),
    listAccounts: createListAccounts(internals),
    switchAccount: createSwitchAccount(internals),
    updateUser: createUpdateUser(internals),
    deleteUser: createDeleteUser(internals),
    signOut: createSignOut(internals),
    setLocale: (locale) => {
      internals.locale = locale
    },
    clearToken: () => internals.tokenStore.clear(),
    decodeToken
  }
}
