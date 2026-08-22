import type { AuthUser } from "@auth-ts/server"
import { readLifetimeClaims } from "../lib/read-lifetime-claims.ts"
import {
  createDeleteUser,
  createListSessions,
  createLogout,
  createRevokeSession,
  createUpdateUser
} from "../methods/account.ts"
import {
  createDisconnect,
  createListAccounts,
  createListConnections,
  createSwitchAccount
} from "../methods/connections-and-accounts.ts"
import { createGetToken } from "../methods/get-token.ts"
import { createGetUser } from "../methods/get-user.ts"
import { createConnect, createSignIn } from "../methods/oauth.ts"
import type { SignInResult } from "../methods/sign-in-with-code.ts"
import {
  createSendCode,
  createSignInAsGuest,
  createVerifyCode
} from "../methods/sign-in-with-code.ts"
import { createAuthClientInternals } from "./auth-client-internals.ts"
import type { AuthClientOptions } from "./auth-client-options.ts"
import type { UserListener } from "./user-store.ts"

/**
 * The browser client.
 *
 * Two planes, one cookie: every method except `getToken` is authenticated
 * server-side by the refresh cookie, and the access token exists purely as the
 * data-plane credential for something like PostgREST. An application that never
 * calls `getToken` still gets working sign-in, profile updates, and a correct
 * user.
 */
export interface AuthClient {
  /** A valid access token, refreshed when needed. Hand this to your data client. */
  getToken: () => Promise<string>
  /** The signed-in user, or `null`. Free when the token is valid. */
  getUser: () => Promise<AuthUser | null>
  /** Subscribes to user changes. Returns the unsubscribe function. */
  subscribe: (listener: UserListener) => () => void
  /** The last known user, without any network call. For synchronous render paths. */
  getCachedUser: () => AuthUser | null
  sendCode: ReturnType<typeof createSendCode>
  verifyCode: ReturnType<typeof createVerifyCode>
  signInAsGuest: ReturnType<typeof createSignInAsGuest>
  signIn: ReturnType<typeof createSignIn>
  connect: ReturnType<typeof createConnect>
  listConnections: ReturnType<typeof createListConnections>
  disconnect: ReturnType<typeof createDisconnect>
  listSessions: ReturnType<typeof createListSessions>
  revokeSession: ReturnType<typeof createRevokeSession>
  listAccounts: ReturnType<typeof createListAccounts>
  switchAccount: ReturnType<typeof createSwitchAccount>
  updateUser: ReturnType<typeof createUpdateUser>
  deleteUser: ReturnType<typeof createDeleteUser>
  logout: ReturnType<typeof createLogout>
  /** Changes the locale sent on subsequent requests. */
  setLocale: (locale: string | undefined) => void
  /** Drops the in-memory token only — the 401-retry helper. Leaves the session alone. */
  clearToken: () => void
}

/**
 * Creates the auth client.
 *
 * Construction performs no network request and touches no storage, so importing
 * the module that calls it is free and safe during server-side rendering.
 * Everything reconciles on the first read: `getUser` refreshes when there is no
 * valid token, which covers every boot case — a revoked session resolves to
 * `null`, a valid cookie with wiped storage signs the user back in, and a
 * signed-out visitor makes exactly one request.
 */
export function createAuthClient(options: AuthClientOptions = {}): AuthClient {
  const internals = createAuthClientInternals(options)

  /** Writes a completed sign-in into both caches at once, so they cannot disagree. */
  const primeSession = (result: SignInResult) => {
    internals.tokenStore.set(
      result.accessToken,
      readLifetimeClaims(result.accessToken)
    )
    internals.userStore.set(result.user)
  }

  const getToken = createGetToken(internals)

  return {
    getToken,
    getUser: createGetUser(internals, getToken),
    subscribe: (listener) => internals.userStore.subscribe(listener),
    getCachedUser: () => internals.userStore.restore(),
    sendCode: createSendCode(internals),
    verifyCode: createVerifyCode(internals, primeSession),
    signInAsGuest: createSignInAsGuest(internals, primeSession),
    signIn: createSignIn(internals),
    connect: createConnect(internals),
    listConnections: createListConnections(internals),
    disconnect: createDisconnect(internals),
    listSessions: createListSessions(internals),
    revokeSession: createRevokeSession(internals),
    listAccounts: createListAccounts(internals),
    switchAccount: createSwitchAccount(internals, primeSession),
    updateUser: createUpdateUser(internals),
    deleteUser: createDeleteUser(internals),
    logout: createLogout(internals, primeSession),
    setLocale: (locale) => {
      internals.locale = locale
    },
    clearToken: () => internals.tokenStore.clear()
  }
}
