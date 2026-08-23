import type { AccountInfo, AuthUser, ConnectionInfo } from "@auth-ts/server"
import type { AuthClientInternals } from "../core/auth-client-internals"

/** Lists the providers linked to this user. */
export function createListConnections(internals: AuthClientInternals) {
  return async function listConnections(): Promise<ConnectionInfo[]> {
    return internals.fetchJson<ConnectionInfo[]>({
      method: "GET",
      path: "/connections"
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
      path: `/connections/${encodeURIComponent(input.provider)}`
    })
  }
}

/** Lists every account signed in to this browser. Requires `multiAccount` server-side. */
export function createListAccounts(internals: AuthClientInternals) {
  return async function listAccounts(): Promise<AccountInfo[]> {
    return internals.fetchJson<AccountInfo[]>({
      method: "GET",
      path: "/accounts"
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
      body: input
    })

    return result.user
  }
}
