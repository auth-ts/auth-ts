import type { AuthUser } from "../../core/auth-database"
import type { ProviderTokenResult } from "../../endpoints/identities/$id/token"
import type { AuthClientInternals } from "../core/auth-client-internals"
import { reviveUser } from "../lib/revive-user"

/** Input for reading a connected account's access token. */
export interface GetProviderTokenInput {
  /** The identity's `id`, from your own `identities` table. */
  id: string
}

/** `GET /identities/:id/token`, with `expiresAt` revived to a `Date`. */
export async function getProviderToken(
  internals: AuthClientInternals,
  input: GetProviderTokenInput
): Promise<ProviderTokenResult> {
  const result = await internals.fetchJson<
    Omit<ProviderTokenResult, "expiresAt"> & { expiresAt: string | null }
  >({
    method: "GET",
    path: `/identities/${encodeURIComponent(input.id)}/token`,
    authenticated: true
  })

  return {
    ...result,
    expiresAt: result.expiresAt ? new Date(result.expiresAt) : null
  }
}

/** `GET /users`: every account signed in to this browser. */
export async function listUsers(
  internals: AuthClientInternals
): Promise<AuthUser[]> {
  const users = await internals.fetchJson<AuthUser[]>({
    method: "GET",
    path: "/users",
    authenticated: true
  })

  return users.map(reviveUser)
}

/** Input for switching users. */
export interface SwitchUserInput {
  userId: string
}

/** `POST /users/switch`; the token it returns replaces the stored one. */
export async function switchUser(
  internals: AuthClientInternals,
  input: SwitchUserInput
): Promise<AuthUser> {
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
