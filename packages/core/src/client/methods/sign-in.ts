import type { AuthUser } from "../../core/auth-db"
import type { AuthClientInternals } from "../core/auth-client-internals"
import { reviveUser } from "../lib/revive-user"

/** Exactly one identifier: whichever you pass selects the channel. */
export type SendSignInCodeInput =
  | { email: string; phoneNumber?: never }
  | { phoneNumber: string; email?: never }

/** The identifier, the code, and any declared sign-up fields. */
export type SignInWithCodeInput = SendSignInCodeInput & {
  code: string
  /** Applied only if this verification creates the account. */
  additionalFields?: Record<string, string | number | boolean>
}

/** What a completed sign-in returns. */
export interface SignInResult {
  user: AuthUser
  /** The access token for the new session, already stored by the client. */
  token: string
}

/** Builds `sendSignInCode`. */
export function createSendSignInCode(internals: AuthClientInternals) {
  return async function sendSignInCode(
    input: SendSignInCodeInput
  ): Promise<void> {
    await internals.fetchJson({
      method: "POST",
      path: "/sign-in/send-code",
      body: input
    })
  }
}

/** Builds `signInWithCode`. */
export function createSignInWithCode(internals: AuthClientInternals) {
  return async function signInWithCode(
    input: SignInWithCodeInput
  ): Promise<SignInResult> {
    const result = await internals.fetchJson<SignInResult>({
      method: "POST",
      path: "/sign-in/code",
      body: input
    })
    internals.tokenStore.set(result.token)

    return { ...result, user: reviveUser(result.user) }
  }
}

/** Input for anonymous sign-in. */
export interface SignInAsGuestInput {
  additionalFields?: Record<string, string | number | boolean>
}

/** Builds `signInAsGuest`. */
export function createSignInAsGuest(internals: AuthClientInternals) {
  return async function signInAsGuest(
    input: SignInAsGuestInput = {}
  ): Promise<SignInResult> {
    const result = await internals.fetchJson<SignInResult>({
      method: "POST",
      path: "/sign-in/guest",
      body: input
    })
    internals.tokenStore.set(result.token)

    return { ...result, user: reviveUser(result.user) }
  }
}
