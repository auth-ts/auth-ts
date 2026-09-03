import type { AuthUser } from "@auth-ts/server"
import type { AuthClientInternals } from "../core/auth-client-internals"
import { AuthError } from "../lib/auth-error"
import { reviveUser } from "../lib/revive-user"

/** The flat body accepted by profile updates. */
export type UpdateUserInput = {
  name?: string
  image?: string
} & Record<string, string | number | boolean | undefined>

/** Builds `updateUser`. */
export function createUpdateUser(internals: AuthClientInternals) {
  return async function updateUser(input: UpdateUserInput): Promise<AuthUser> {
    const user = await internals.fetchJson<AuthUser>({
      method: "POST",
      path: "/user",
      body: input,
      authenticated: true
    })
    return reviveUser(user)
  }
}

/** How far a sign-out reaches, for each account it applies to. */
export type SignOutScope = "local" | "others" | "global"

/** Input for signing out. */
export interface SignOutInput {
  scope?: SignOutScope
  /**
   * Which of this browser's accounts to sign out, under `multiUser`.
   *
   * Omit it and every account signed in here goes. Name one and only that
   * account goes, whether it is the active one or a parked one; the rest stay
   * signed in.
   */
  userId?: string
}

/** Builds `signOut`. */
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
  /** `"staleSession"` means call `sendDeleteUserCode` and retry with the code it sends. */
  status: "deleted" | "staleSession"
}

/** Input for account deletion. */
export interface DeleteUserInput {
  code?: string
}

/** Builds `deleteUser`. */
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
      if (error instanceof AuthError && error.code === "staleSession")
        return { status: "staleSession" }
      throw error
    }

    internals.tokenStore.clear()

    return { status: "deleted" }
  }
}

/** Builds `sendDeleteUserCode`. */
export function createSendDeleteUserCode(internals: AuthClientInternals) {
  return async function sendDeleteUserCode(): Promise<void> {
    await internals.fetchJson({
      method: "POST",
      path: "/user/send-delete-code",
      authenticated: true
    })
  }
}
