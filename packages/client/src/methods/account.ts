import type { AuthUser, SessionInfo } from "@auth-ts/server"
import type { AuthClientInternals } from "../core/auth-client-internals"
import { AuthError } from "../lib/auth-error"

/** The flat body accepted by profile updates. */
export type UpdateUserInput = {
  name?: string
  image?: string
} & Record<string, string | number | boolean | undefined>

/** Updates the signed-in user and returns the row as stored. */
export function createUpdateUser(internals: AuthClientInternals) {
  return async function updateUser(input: UpdateUserInput): Promise<AuthUser> {
    const { user } = await internals.fetchJson<{ user: AuthUser }>({
      method: "POST",
      path: "/user",
      body: input,
      authenticated: true
    })
    return user
  }
}

/** How far a sign-out reaches, for each account it applies to. */
export type SignOutScope = "local" | "others" | "global"

/** Input for signing out. */
export interface SignOutInput {
  scope?: SignOutScope
  /**
   * Which of this browser's accounts to sign out, under `multiAccount`.
   *
   * Omit it and every account signed in here goes. Name one and only that
   * account goes, whether it is the active one or a parked one; the rest stay
   * signed in.
   */
  userId?: string
}

/**
 * Signs out.
 *
 * `"others"` deliberately clears nothing locally — it is the "sign out my other
 * devices" button, and this device is meant to survive it.
 *
 * A session that is already gone resolves rather than throwing: the caller
 * asked to end up signed out, and they are.
 */
export function createSignOut(internals: AuthClientInternals) {
  return async function signOut(input: SignOutInput = {}): Promise<void> {
    const scope = input.scope ?? "local"
    try {
      await internals.fetchJson({
        method: "POST",
        path: "/sign-out",
        body: { scope, ...(input.userId ? { userId: input.userId } : {}) },
        authenticated: true
      })
    } catch (error) {
      // Nothing to sign out of is the outcome this asked for, not a failure to
      // report to someone who has already clicked the button.
      if (!(error instanceof AuthError && error.code === "unauthenticated")) {
        throw error
      }
    }

    if (scope !== "others") internals.tokenStore.clear()
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
        body: input,
        authenticated: true
      })
    } catch (error) {
      if (error instanceof AuthError && error.code === "codeSent")
        return { status: "codeRequired" }
      throw error
    }

    internals.tokenStore.clear()

    return { status: "deleted" }
  }
}

/** {@link SessionInfo} as JSON delivers it, before the dates are revived. */
type SessionInfoWire = Omit<SessionInfo, "createdAt" | "expiresAt"> & {
  createdAt: string
  expiresAt: string
}

/** Lists this user's sessions — the devices screen. */
export function createListSessions(internals: AuthClientInternals) {
  return async function listSessions(): Promise<SessionInfo[]> {
    const sessions = await internals.fetchJson<SessionInfoWire[]>({
      method: "GET",
      path: "/sessions",
      authenticated: true
    })

    return sessions.map((session) => ({
      ...session,
      createdAt: new Date(session.createdAt),
      expiresAt: new Date(session.expiresAt)
    }))
  }
}

/** Input for revoking a session. */
export interface RevokeSessionInput {
  id: string
}

/**
 * Revokes one session by id.
 */
export function createRevokeSession(internals: AuthClientInternals) {
  return async function revokeSession(
    input: RevokeSessionInput
  ): Promise<void> {
    await internals.fetchJson<undefined>({
      method: "DELETE",
      path: `/sessions/${encodeURIComponent(input.id)}`,
      authenticated: true
    })
  }
}
