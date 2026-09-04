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
   * Only a token too close to expiry to be worth handing out makes a caller
   * wait. Approaching that point the cached token is returned immediately and
   * the refresh runs behind it, and concurrent callers share a single request —
   * a page that mounts ten components makes one round trip.
   *
   * Nobody signed in is an answer, not a failure, so it resolves `null` rather
   * than throwing. Every other failure — the server erroring, a proxy answering
   * for it, the network dropping — throws and clears nothing: none of those is
   * a verdict on the session.
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
  /**
   * Requests a sign-in code.
   *
   * Always succeeds for a well-formed address, whether or not an account
   * exists — the server has nothing to reveal, since the account is created at
   * verification.
   *
   * @throws {AuthError} `cooldown` or `rateLimited`, both carrying
   * `retryAfter`. Render the countdown rather than only disabling the button.
   */
  sendSignInCode: ReturnType<typeof createSendSignInCode>
  /**
   * Verifies a code and starts a session.
   *
   * The token comes back with the user and is stored on the way through, so the
   * sign-in and the first render cost one round trip between them rather than a
   * sign-in followed by a refresh.
   */
  signInWithCode: ReturnType<typeof createSignInWithCode>
  /**
   * Signs in anonymously.
   *
   * Available only when the server sets `guest: true`. The resulting user is
   * real in every way that matters — they own rows, they have a session — which
   * is what lets them keep everything when they later add an email or connect a
   * provider.
   */
  signInAsGuest: ReturnType<typeof createSignInAsGuest>
  /**
   * Starts an OAuth sign-in, sending the browser to the provider.
   *
   * Resolves only if something goes wrong before the navigation — otherwise the
   * page is on its way out. When the user comes back the session cookie is
   * already set, so the application boots, calls `getToken`, and finds them
   * signed in: the callback hands the SPA no token, and the cookie is what buys
   * the first one.
   *
   * Signing in while already signed in never links accounts. Use
   * `connectProvider` for that.
   */
  signInWithProvider: ReturnType<typeof createSignInWithProvider>
  /** Starts linking a provider to the currently signed-in user. */
  connectProvider: ReturnType<typeof createConnectProvider>
  /**
   * Gets a live access token for one connected account, so this browser can
   * call that provider's API directly.
   *
   * The server refreshes it first when the stored one is spent, so what comes
   * back is usable now. Hold it in a variable for the call you are about to
   * make and ask again next time — it expires, and persisting it would put a
   * credential for somebody else's service in storage this library does not
   * control. The refresh token behind it never leaves the server.
   *
   * @throws {AuthError} `providerReconnectRequired` when the grant is gone —
   * revoked at the provider, expired, or never durable. Send them through
   * `connectProvider` again.
   */
  getProviderToken: ReturnType<typeof createGetProviderToken>
  /** Lists every user signed in to this browser. Requires `multiUser` server-side. */
  listUsers: ReturnType<typeof createListUsers>
  /**
   * Switches to another user already signed in to this browser.
   *
   * The token and user caches are replaced together, so subscribers fire once
   * and the whole interface flips at the same moment rather than briefly
   * showing one user's name above another's data.
   */
  switchUser: ReturnType<typeof createSwitchUser>
  /** Updates the signed-in user and returns the row as stored. */
  updateUser: ReturnType<typeof createUpdateUser>
  /**
   * Deletes the account, in one or two steps.
   *
   * A recently authenticated session deletes immediately; an older one gets a
   * `"staleSession"` result, at which point you call `sendDeleteUserCode()` and
   * retry with the code it sends. The two-step case is reported as a value
   * rather than an error because it is an expected branch of a working flow,
   * not a failure.
   *
   * @throws {AuthError} For a wrong code, or when a guest has no way to receive
   * one.
   */
  deleteUser: ReturnType<typeof createDeleteUser>
  /**
   * Sends the code that confirms account deletion.
   *
   * Goes to whichever address is already on the account — there is nothing to
   * choose, so there is nothing to pass.
   *
   * @throws {AuthError} `cooldown` or `rateLimited`, or
   * `guestCannotReceiveCode` for a guest with no email or phone number on file.
   */
  sendDeleteUserCode: ReturnType<typeof createSendDeleteUserCode>
  /**
   * Signs out.
   *
   * `"others"` deliberately clears nothing locally — it is the "sign out my
   * other devices" button, and this device is meant to survive it.
   *
   * A session that is already gone resolves rather than throwing: the caller
   * asked to end up signed out, and they are.
   */
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
