import type { AuthUser, SessionInfo } from "@auth-ts/server"
import type { AuthClientInternals } from "../core/auth-client-internals.ts"
import { AuthError } from "../lib/auth-error.ts"

/** The flat body accepted by profile updates. */
export type UpdateUserInput = {
  name?: string
  imageURL?: string
} & Record<string, string | number | boolean | undefined>

/** Updates the signed-in user and refreshes the local mirror. */
export function createUpdateUser(internals: AuthClientInternals) {
  return async function updateUser(input: UpdateUserInput): Promise<AuthUser> {
    const { user } = await internals.fetchJson<{ user: AuthUser }>({
      method: "PATCH",
      path: "/user",
      body: input
    })
    internals.userStore.set(user)

    return user
  }
}

/** How far a sign-out reaches. */
export type LogoutScope = "local" | "others" | "global"

/** Input for signing out. */
export interface LogoutInput {
  scope?: LogoutScope
}

/**
 * Signs out.
 *
 * `"others"` deliberately clears nothing locally — it is the "sign out my other
 * devices" button, and this device is meant to survive it. The other two scopes
 * clear the token and the user mirror, and with multiple accounts the server may
 * promote the next one, in which case the caches are primed with that user
 * instead of emptied.
 */
export function createLogout(
  internals: AuthClientInternals,
  primeSession: (result: { accessToken: string; user: AuthUser }) => void
) {
  return async function logout(
    input: LogoutInput = {}
  ): Promise<{ switchedTo: AuthUser } | null> {
    const scope = input.scope ?? "local"
    const result = await internals.fetchJson<
      { switchedTo?: AuthUser; accessToken?: string } | undefined
    >({
      method: "POST",
      path: "/logout",
      body: { scope }
    })

    if (scope === "others") return null

    if (result?.switchedTo && result.accessToken) {
      primeSession({ accessToken: result.accessToken, user: result.switchedTo })
      return { switchedTo: result.switchedTo }
    }

    internals.tokenStore.clear()
    internals.userStore.set(null)

    return null
  }
}

/** What a deletion attempt resolved to. */
export interface DeleteUserResult {
  /** `"codeRequired"` means a confirmation code was sent — prompt for it and call again. */
  status: "deleted" | "codeRequired"
}

/** Input for account deletion. */
export interface DeleteUserInput {
  code?: string
}

/**
 * Deletes the account, in one or two steps.
 *
 * A recently authenticated session deletes immediately; an older one gets a
 * `"codeRequired"` result, at which point you collect the emailed code and call
 * again with it. The two-step case is reported as a value rather than an error
 * because it is an expected branch of a working flow, not a failure.
 *
 * @throws {AuthError} For a wrong code, or when a guest has no way to receive one.
 */
export function createDeleteUser(internals: AuthClientInternals) {
  return async function deleteUser(
    input: DeleteUserInput = {}
  ): Promise<DeleteUserResult> {
    try {
      await internals.fetchJson({
        method: "DELETE",
        path: "/user",
        body: input
      })
    } catch (error) {
      if (error instanceof AuthError && error.code === "codeSent")
        return { status: "codeRequired" }
      throw error
    }

    internals.tokenStore.clear()
    internals.userStore.set(null)

    return { status: "deleted" }
  }
}

/** Lists this user's sessions — the devices screen. */
export function createListSessions(internals: AuthClientInternals) {
  return async function listSessions(): Promise<SessionInfo[]> {
    const { sessions } = await internals.fetchJson<{ sessions: SessionInfo[] }>(
      {
        method: "GET",
        path: "/sessions"
      }
    )

    return sessions
  }
}

/** Input for revoking a session. */
export interface RevokeSessionInput {
  id: string
}

/**
 * Revokes one session by id.
 *
 * Revoking the current one is a local sign-out, so the caches are cleared to
 * match — the server has already cleared the cookie.
 */
export function createRevokeSession(
  internals: AuthClientInternals,
  getSessions: () => Promise<SessionInfo[]>
) {
  return async function revokeSession(
    input: RevokeSessionInput
  ): Promise<void> {
    const sessions = await getSessions()
    const revokingCurrent = sessions.some(
      (session) => session.id === input.id && session.current
    )

    await internals.fetchJson({
      method: "DELETE",
      path: `/sessions/${encodeURIComponent(input.id)}`
    })

    if (revokingCurrent) {
      internals.tokenStore.clear()
      internals.userStore.set(null)
    }
  }
}
