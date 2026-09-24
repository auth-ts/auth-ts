import type { AuthUser } from "../../core/auth-database"
import type { ProviderTokenResult } from "../../endpoints/identities/$id/token"
import { decodeToken } from "../lib/decode-token"
import type {
  DeleteUserInput,
  DeleteUserResult,
  RevokeSessionInput,
  RevokeSessionResult,
  SendEmailUpdateCodeInput,
  SendPhoneUpdateCodeInput,
  SendUpdateCodeResult,
  SignOutInput,
  UpdateUserInput,
  VerifyIdentityInput,
  VerifyUpdateInput,
  VerifyUpdateResult
} from "../methods/account"
import {
  deleteUser,
  revokeSession,
  sendEmailUpdateCode,
  sendIdentityCode,
  sendPhoneUpdateCode,
  signOut,
  updateUser,
  verifyEmailUpdate,
  verifyIdentity,
  verifyPhoneUpdate
} from "../methods/account"
import type { GetTokenOptions, RefreshToken } from "../methods/get-token"
import { createGetToken } from "../methods/get-token"
import type {
  GetProviderTokenInput,
  SwitchUserInput
} from "../methods/identities-and-users"
import {
  getProviderToken,
  listUsers,
  switchUser
} from "../methods/identities-and-users"
import type { OAuthNavigationInput } from "../methods/oauth"
import { connectProvider, signInWithProvider } from "../methods/oauth"
import type {
  SendCodeResult,
  SendSignInCodeInput,
  SignInAsGuestInput,
  SignInResult,
  SignInWithCodeInput
} from "../methods/sign-in"
import {
  sendSignInCode,
  signInAsGuest,
  signInWithCode
} from "../methods/sign-in"
import { createAuthClientInternals } from "./auth-client-internals"
import type { AuthClientOptions } from "./auth-client-options"

/** The browser client returned by `createAuthClient`. */
export interface AuthClient {
  /** A valid access token, refreshed when needed, or `null` when signed out. */
  getToken: (options?: GetTokenOptions) => Promise<string | null>
  /** Fetches a new token and its user now, or `null` when signed out. */
  refresh: RefreshToken["refresh"]
  /**
   * Sends a sign-in code to an email or phone number.
   * @throws {AuthError} `rateLimited`, with `retryAfter` in seconds.
   */
  sendSignInCode: (input: SendSignInCodeInput) => Promise<SendCodeResult>
  /** Verifies a code and signs in, creating the account if new. */
  signInWithCode: (input: SignInWithCodeInput) => Promise<SignInResult>
  /** Signs in as a guest. Needs `guest: true` on the server. */
  signInAsGuest: (input?: SignInAsGuestInput) => Promise<SignInResult>
  /** Sends the browser to a provider to sign in. Never links accounts. */
  signInWithProvider: (input: OAuthNavigationInput) => Promise<void>
  /** Sends the browser to a provider to link it to the signed-in user. */
  connectProvider: (input: OAuthNavigationInput) => Promise<void>
  /**
   * A live access token for one connected account's API.
   * @throws {AuthError} `providerReconnectRequired` when the grant is gone.
   */
  getProviderToken: (
    input: GetProviderTokenInput
  ) => Promise<ProviderTokenResult>
  /** Every user signed in to this browser. Needs `multiUser`. */
  listUsers: () => Promise<AuthUser[]>
  /** Switches to another user signed in to this browser. Needs `multiUser`. */
  switchUser: (input: SwitchUserInput) => Promise<AuthUser>
  /** Updates `name`, `image` or additional fields, and returns the user. */
  updateUser: (input: UpdateUserInput) => Promise<AuthUser>
  /** Deletes the account. Returns `verificationRequired` until identity is confirmed. */
  deleteUser: (input?: DeleteUserInput) => Promise<DeleteUserResult>
  /** Signs out another device. Returns `verificationRequired` until identity is confirmed. */
  revokeSession: (input: RevokeSessionInput) => Promise<RevokeSessionResult>
  /** Sends a code to the account's own email or phone to confirm identity. */
  sendIdentityCode: () => Promise<SendCodeResult>
  /** Verifies that code. Sensitive actions then work for an hour. */
  verifyIdentity: (input: VerifyIdentityInput) => Promise<void>
  /** Sends a code to a new email address. Needs confirmed identity. */
  sendEmailUpdateCode: (
    input: SendEmailUpdateCodeInput
  ) => Promise<SendUpdateCodeResult>
  /** Verifies that code and changes the account's email. */
  verifyEmailUpdate: (input: VerifyUpdateInput) => Promise<VerifyUpdateResult>
  /** Sends a code to a new phone number. Needs confirmed identity. */
  sendPhoneUpdateCode: (
    input: SendPhoneUpdateCodeInput
  ) => Promise<SendUpdateCodeResult>
  /** Verifies that code and changes the account's phone number. */
  verifyPhoneUpdate: (input: VerifyUpdateInput) => Promise<VerifyUpdateResult>
  /** Signs out this browser, one user or all, locally or everywhere. */
  signOut: (input?: SignOutInput) => Promise<void>
  /** Sets the locale sent as `Accept-Language`. */
  setLocale: (locale: string | undefined) => void
  /** Drops the in-memory token, for retrying a 401. The session stays. */
  clearToken: () => void
  /** Reads a token's claims without verifying it. Never authorize with it. */
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
  internals.requireToken = requireToken

  return {
    getToken,
    refresh,
    sendSignInCode: (input) => sendSignInCode(internals, input),
    signInWithCode: (input) => signInWithCode(internals, input),
    signInAsGuest: (input) => signInAsGuest(internals, input),
    signInWithProvider: (input) => signInWithProvider(internals, input),
    connectProvider: (input) => connectProvider(internals, input),
    getProviderToken: (input) => getProviderToken(internals, input),
    listUsers: () => listUsers(internals),
    switchUser: (input) => switchUser(internals, input),
    updateUser: (input) => updateUser(internals, input),
    deleteUser: (input) => deleteUser(internals, input),
    revokeSession: (input) => revokeSession(internals, input),
    sendIdentityCode: () => sendIdentityCode(internals),
    verifyIdentity: (input) => verifyIdentity(internals, input),
    sendEmailUpdateCode: (input) => sendEmailUpdateCode(internals, input),
    verifyEmailUpdate: (input) => verifyEmailUpdate(internals, input),
    sendPhoneUpdateCode: (input) => sendPhoneUpdateCode(internals, input),
    verifyPhoneUpdate: (input) => verifyPhoneUpdate(internals, input),
    signOut: (input) => signOut(internals, input),
    setLocale: (locale) => {
      internals.locale = locale
    },
    clearToken: () => internals.tokenStore.clear(),
    decodeToken
  }
}
