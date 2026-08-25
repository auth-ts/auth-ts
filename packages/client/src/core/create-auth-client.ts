import { decodeToken } from "../lib/decode-token"
import {
  createDeleteUser,
  createListSessions,
  createRevokeSession,
  createSendDeleteUserCode,
  createSignOut,
  createUpdateUser
} from "../methods/account"
import { createGetSession } from "../methods/get-session"
import type { GetTokenOptions } from "../methods/get-token"
import { createGetToken } from "../methods/get-token"
import { createGetUser } from "../methods/get-user"
import {
  createDisconnectIdentity,
  createGetProviderToken,
  createListIdentities,
  createListUsers,
  createSwitchUser
} from "../methods/identities-and-users"
import {
  createConnectProvider,
  createSignInWithProvider
} from "../methods/oauth"
import {
  createSendSignInCode,
  createSignInAsGuest,
  createSignInWithCode
} from "../methods/sign-in"
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
  sendSignInCode: ReturnType<typeof createSendSignInCode>
  signInWithCode: ReturnType<typeof createSignInWithCode>
  signInAsGuest: ReturnType<typeof createSignInAsGuest>
  signInWithProvider: ReturnType<typeof createSignInWithProvider>
  connectProvider: ReturnType<typeof createConnectProvider>
  listIdentities: ReturnType<typeof createListIdentities>
  disconnectIdentity: ReturnType<typeof createDisconnectIdentity>
  getProviderToken: ReturnType<typeof createGetProviderToken>
  listSessions: ReturnType<typeof createListSessions>
  revokeSession: ReturnType<typeof createRevokeSession>
  listUsers: ReturnType<typeof createListUsers>
  switchUser: ReturnType<typeof createSwitchUser>
  updateUser: ReturnType<typeof createUpdateUser>
  deleteUser: ReturnType<typeof createDeleteUser>
  sendDeleteUserCode: ReturnType<typeof createSendDeleteUserCode>
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
    sendSignInCode: createSendSignInCode(internals),
    signInWithCode: createSignInWithCode(internals),
    signInAsGuest: createSignInAsGuest(internals),
    signInWithProvider: createSignInWithProvider(internals),
    connectProvider: createConnectProvider(internals),
    listIdentities: createListIdentities(internals),
    disconnectIdentity: createDisconnectIdentity(internals),
    getProviderToken: createGetProviderToken(internals),
    listSessions: createListSessions(internals),
    revokeSession: createRevokeSession(internals),
    listUsers: createListUsers(internals),
    switchUser: createSwitchUser(internals),
    updateUser: createUpdateUser(internals),
    deleteUser: createDeleteUser(internals),
    sendDeleteUserCode: createSendDeleteUserCode(internals),
    signOut: createSignOut(internals),
    setLocale: (locale) => {
      internals.locale = locale
    },
    clearToken: () => internals.tokenStore.clear(),
    decodeToken
  }
}
