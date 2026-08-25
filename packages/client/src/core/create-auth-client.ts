import { decodeToken } from "../lib/decode-token"
import {
  createDeleteUser,
  createSendDeleteUserCode,
  createSignOut,
  createUpdateUser
} from "../methods/account"
import type { GetTokenOptions, RefreshToken } from "../methods/get-token"
import { createGetToken } from "../methods/get-token"
import {
  createGetProviderToken,
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
  /**
   * Exchanges the refresh cookie for a token now, and answers with the user it
   * was minted for — or `null` when nobody is signed in.
   *
   * The cheapest way to learn who is here: `GET /token` reads that row to mint,
   * so the user arrives with the token and a cold boot costs one request. It
   * always asks, ignoring whatever is in memory, which is what makes it a
   * reload rather than a read.
   *
   * It is not how you keep a name on screen up to date. That row is yours —
   * query `users` through your data plane, where a rename in another tab
   * arrives without a token being reminted.
   */
  refresh: RefreshToken["refresh"]
  sendSignInCode: ReturnType<typeof createSendSignInCode>
  signInWithCode: ReturnType<typeof createSignInWithCode>
  signInAsGuest: ReturnType<typeof createSignInAsGuest>
  signInWithProvider: ReturnType<typeof createSignInWithProvider>
  connectProvider: ReturnType<typeof createConnectProvider>
  getProviderToken: ReturnType<typeof createGetProviderToken>
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
    refresh,
    sendSignInCode: createSendSignInCode(internals),
    signInWithCode: createSignInWithCode(internals),
    signInAsGuest: createSignInAsGuest(internals),
    signInWithProvider: createSignInWithProvider(internals),
    connectProvider: createConnectProvider(internals),
    getProviderToken: createGetProviderToken(internals),
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
