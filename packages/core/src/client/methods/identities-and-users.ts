import type { AuthUser } from "../../core/auth-database"
import type { ProviderTokenResult } from "../../endpoints/identities/$id/token"
import type { AuthClientInternals } from "../core/auth-client-internals"
import { AuthError } from "../lib/auth-error"
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
  if (internals.sessionStore) {
    const stored = await internals.sessionStore.read()
    if (!stored.multiUser)
      throw new AuthError("notFound", 404, "Multiple accounts are not enabled.")
    const users = await Promise.all(
      Object.entries(stored.accounts).map(async ([id, credential]) => {
        const result = await internals.exchangeSession(credential)
        if (!result || result.user.id !== id) {
          await internals.sessionStore?.remove(id, credential)
          return null
        }
        if (result.multiUser === false)
          throw new AuthError(
            "notFound",
            404,
            "Multiple accounts are not enabled."
          )
        return reviveUser(result.user)
      })
    )
    return users.filter((user): user is AuthUser => user !== null)
  }
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
  const generation = internals.tokenStore.invalidate()
  if (internals.sessionStore) {
    const stored = await internals.sessionStore.read()
    const credential = Object.hasOwn(stored.accounts, input.userId)
      ? stored.accounts[input.userId]
      : undefined
    if (!stored.multiUser || !credential)
      throw new AuthError("notFound", 404, "No such signed-in account.")
    const result = await internals.exchangeSession(credential)
    if (!result || result.user.id !== input.userId) {
      await internals.sessionStore.remove(input.userId, credential)
      throw new AuthError("notFound", 404, "No such signed-in account.")
    }
    if (result.multiUser === false)
      throw new AuthError("notFound", 404, "Multiple accounts are not enabled.")
    if (
      !(await internals.sessionStore.select(
        input.userId,
        credential,
        () => internals.tokenStore.generation() === generation
      ))
    )
      throw new Error("The account switch was superseded.")
    if (internals.tokenStore.generation() !== generation)
      throw new Error("The account switch was superseded.")
    internals.attempts = {}
    internals.tokenStore.set(result.token)
    return reviveUser(result.user)
  }
  const result = await internals.fetchJson<{
    token: string
    user: AuthUser
  }>({
    method: "POST",
    path: "/users/switch",
    body: input,
    authenticated: true
  })
  if (internals.tokenStore.generation() !== generation)
    throw new Error("The account switch was superseded.")
  internals.tokenStore.set(result.token)

  return reviveUser(result.user)
}
