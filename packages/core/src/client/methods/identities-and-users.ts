import type { AuthUser } from "../../core/auth-database"
import type { ProviderTokenResult } from "../../endpoints/identities/$id/token"
import type { AuthClientInternals } from "../core/auth-client-internals"
import { reviveUser } from "../lib/revive-user"

/** Input for reading a connected account's access token. */
export interface GetProviderTokenInput {
  /** The identity's `id`, from your own `identities` table. */
  id: string
}

/** Builds `getProviderToken`. */
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

/** Builds `listUsers`. */
export function createListUsers(internals: AuthClientInternals) {
  return async function listUsers(): Promise<AuthUser[]> {
    const users = await internals.fetchJson<AuthUser[]>({
      method: "GET",
      path: "/users",
      authenticated: true
    })

    return users.map(reviveUser)
  }
}

/** Input for switching users. */
export interface SwitchUserInput {
  userId: string
}

/** Builds `switchUser`. */
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

    return reviveUser(result.user)
  }
}
