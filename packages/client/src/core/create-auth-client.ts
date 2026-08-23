import {
  createDeleteUser,
  createListSessions,
  createRevokeSession,
  createSignOut,
  createUpdateUser
} from "../methods/account"
import {
  createDisconnect,
  createListAccounts,
  createListConnections,
  createSwitchAccount
} from "../methods/connections-and-accounts"
import { createGetSession } from "../methods/get-session"
import { createGetToken } from "../methods/get-token"
import { createGetUser } from "../methods/get-user"
import { createConnect, createSignIn } from "../methods/oauth"
import {
  createSendCode,
  createSignInAsGuest,
  createVerifyCode
} from "../methods/sign-in-with-code"
import { createAuthClientInternals } from "./auth-client-internals"
import type { AuthClientOptions } from "./auth-client-options"

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
  /** The user, the session, and a token — or `null`. Always reads the server. */
  getUser: ReturnType<typeof createGetUser>
  /** The session this browser is on, confirming it is live and keeping it that way. */
  getSession: ReturnType<typeof createGetSession>
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
  signOut: ReturnType<typeof createSignOut>
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

  const getToken = createGetToken(internals)

  return {
    getToken,
    getUser: createGetUser(internals),
    getSession: createGetSession(internals),
    sendCode: createSendCode(internals),
    verifyCode: createVerifyCode(internals),
    signInAsGuest: createSignInAsGuest(internals),
    signIn: createSignIn(internals),
    connect: createConnect(internals),
    listConnections: createListConnections(internals),
    disconnect: createDisconnect(internals),
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
    clearToken: () => internals.tokenStore.clear()
  }
}
