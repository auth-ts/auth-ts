import type {
  AuthUser,
  RevokeSessionResult,
  SessionInfo
} from "@auth-ts/server"
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
   * Omit it — the default, as in Clerk — and every account signed in here
   * goes. Name one and only that account goes: the active one, in which case
   * the server promotes the next parked account, or a parked one, which leaves
   * the active session untouched.
   */
  userId?: string
}

/**
 * Signs out.
 *
 * `"others"` deliberately clears nothing locally — it is the "sign out my other
 * devices" button, and this device is meant to survive it. The other two scopes
 * clear the token and the user mirror; when the account signed out was the
 * active one and another is parked, the server promotes it and the caches are
 * primed with that user instead of emptied.
 *
 * A session that is already gone resolves to `null` rather than throwing: the
 * caller asked to end up signed out, and they are.
 */
export function createSignOut(internals: AuthClientInternals) {
  return async function signOut(
    input: SignOutInput = {}
  ): Promise<{ switchedTo: AuthUser } | null> {
    const scope = input.scope ?? "local"
    let result: { switchedTo?: AuthUser; token?: string } | undefined
    try {
      result = await internals.fetchJson({
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
      internals.tokenStore.clear()

      return null
    }

    if (scope === "others") return null

    // Signing out of the active account under `multiAccount` promotes a parked
    // one and hands back its token; only a sign-out with nothing to promote
    // leaves the browser with no token at all.
    if (result?.switchedTo && result.token) {
      internals.tokenStore.set(result.token)

      return { switchedTo: result.switchedTo }
    }

    internals.tokenStore.clear()

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
 *
 * Revoking the current one is a local sign-out, so the caches are cleared to
 * match — the server has already cleared the cookie, and says in the response
 * that it did, so there is no need to list the sessions first to find out.
 */
export function createRevokeSession(internals: AuthClientInternals) {
  return async function revokeSession(
    input: RevokeSessionInput
  ): Promise<void> {
    const result = await internals.fetchJson<RevokeSessionResult | undefined>({
      method: "DELETE",
      path: `/sessions/${encodeURIComponent(input.id)}`,
      authenticated: true
    })

    if (!result?.current) return

    // Revoking the current session under `multiAccount` moves the browser to a
    // parked account, and that account's token comes back with it.
    if (result.token) {
      internals.tokenStore.set(result.token)
      return
    }

    internals.tokenStore.clear()
  }
}
