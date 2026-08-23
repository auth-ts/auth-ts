import type { AccountInfo, AuthUser, IdentityInfo } from "@auth-ts/server"
import type { AuthClientInternals } from "../core/auth-client-internals"

/** Lists the providers linked to this user. */
export function createListIdentities(internals: AuthClientInternals) {
  return async function listIdentities(): Promise<IdentityInfo[]> {
    return internals.fetchJson<IdentityInfo[]>({
      method: "GET",
      path: "/identities",
      authenticated: true
    })
  }
}

/** Input for unlinking a provider. */
export interface DisconnectInput {
  provider: string
}

/** Unlinks a provider. */
export function createDisconnect(internals: AuthClientInternals) {
  return async function disconnect(input: DisconnectInput): Promise<void> {
    await internals.fetchJson({
      method: "DELETE",
      path: `/identities/${encodeURIComponent(input.provider)}`,
      authenticated: true
    })
  }
}

/** Lists every account signed in to this browser. Requires `multiAccount` server-side. */
export function createListAccounts(internals: AuthClientInternals) {
  return async function listAccounts(): Promise<AccountInfo[]> {
    return internals.fetchJson<AccountInfo[]>({
      method: "GET",
      path: "/accounts",
      authenticated: true
    })
  }
}

/** Input for switching accounts. */
export interface SwitchAccountInput {
  userId: string
}

/**
 * Switches to another account already signed in to this browser.
 *
 * The token and user caches are replaced together, so subscribers fire once and
 * the whole interface flips at the same moment rather than briefly showing one
 * account's name above another's data.
 */
export function createSwitchAccount(internals: AuthClientInternals) {
  return async function switchAccount(
    input: SwitchAccountInput
  ): Promise<AuthUser> {
    const result = await internals.fetchJson<{
      token: string
      user: AuthUser
    }>({
      method: "POST",
      path: "/accounts/switch",
      body: input,
      authenticated: true
    })
    internals.tokenStore.set(result.token)

    return result.user
  }
}
