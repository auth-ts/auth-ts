import type {
  AuthIdentity,
  AuthUser,
  ProviderTokenResult
} from "@auth-ts/server"
import type { AuthClientInternals } from "../core/auth-client-internals"

/** Lists the providers linked to this user. */
export function createListIdentities(internals: AuthClientInternals) {
  return async function listIdentities(): Promise<AuthIdentity[]> {
    return internals.fetchJson<AuthIdentity[]>({
      method: "GET",
      path: "/identities",
      authenticated: true
    })
  }
}

/** Input for unlinking one connected account. */
export interface DisconnectIdentityInput {
  /** The identity's `id`, from `authClient.listIdentities`. */
  id: string
}

/**
 * Unlinks one connected account.
 *
 * By identity, not by provider: someone may have two Google accounts connected,
 * and disconnecting "Google" would take both.
 */
export function createDisconnectIdentity(internals: AuthClientInternals) {
  return async function disconnectIdentity(
    input: DisconnectIdentityInput
  ): Promise<void> {
    await internals.fetchJson({
      method: "DELETE",
      path: `/identities/${encodeURIComponent(input.id)}`,
      authenticated: true
    })
  }
}

/** Input for reading a connected account's access token. */
export interface GetProviderTokenInput {
  /** The identity's `id`, from `authClient.listIdentities`. */
  id: string
}

/**
 * Gets a live access token for one connected account, so this browser can call
 * that provider's API directly.
 *
 * The server refreshes it first when the stored one is spent, so what comes
 * back is usable now. Hold it in a variable for the call you are about to make
 * and ask again next time — it expires, and persisting it would put a
 * credential for somebody else's service in storage this library does not
 * control. The refresh token behind it never leaves the server.
 *
 * @throws {AuthError} `providerReconnectRequired` when the grant is gone —
 * revoked at the provider, expired, or never durable. Send them through
 * `connectProvider` again.
 */
export function createGetProviderToken(internals: AuthClientInternals) {
  return async function getProviderToken(
    input: GetProviderTokenInput
  ): Promise<ProviderTokenResult> {
    return internals.fetchJson<ProviderTokenResult>({
      method: "GET",
      path: `/identities/${encodeURIComponent(input.id)}/token`,
      authenticated: true
    })
  }
}

/** Lists every user signed in to this browser. Requires `multiUser` server-side. */
export function createListUsers(internals: AuthClientInternals) {
  return async function listUsers(): Promise<AuthUser[]> {
    return internals.fetchJson<AuthUser[]>({
      method: "GET",
      path: "/users",
      authenticated: true
    })
  }
}

/** Input for switching users. */
export interface SwitchUserInput {
  userId: string
}

/**
 * Switches to another user already signed in to this browser.
 *
 * The token and user caches are replaced together, so subscribers fire once and
 * the whole interface flips at the same moment rather than briefly showing one
 * user's name above another's data.
 */
export function createSwitchUser(internals: AuthClientInternals) {
  return async function switchUser(input: SwitchUserInput): Promise<AuthUser> {
    const result = await internals.fetchJson<{
      token: string
      user: AuthUser
    }>({
      method: "POST",
      path: "/users/switch",
      body: input,
      authenticated: true
    })
    internals.tokenStore.set(result.token)

    return result.user
  }
}
