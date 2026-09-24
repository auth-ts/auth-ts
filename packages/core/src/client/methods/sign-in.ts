import type { AuthUser } from "../../core/auth-database"
import type { AuthClientInternals } from "../core/auth-client-internals"
import { reviveUser } from "../lib/revive-user"

/** Exactly one identifier: whichever you pass selects the channel. */
export type SendSignInCodeInput =
  | { email: string; phoneNumber?: never }
  | { phoneNumber: string; email?: never }

/** The code, and any declared sign-up fields. */
export interface SignInWithCodeInput {
  /** The code the user entered. */
  code: string
  /** The `attempt` from `sendSignInCode`. Only needed where there are no cookies. */
  attempt?: string
  /** Applied only if this verification creates the account. */
  additionalFields?: Record<string, string | number | boolean>
}

/** What a send returns: the attempt token the code is bound to. */
export interface SendCodeResult {
  /** Identifies this request's code. Sent as a cookie too. */
  attempt: string
}

/** What a completed sign-in returns. */
export interface SignInResult {
  /** The signed-in user. */
  user: AuthUser
  /** The access token for the new session, already stored by the client. */
  token: string
}

/** `POST /sign-in/send-code`. */
export async function sendSignInCode(
  internals: AuthClientInternals,
  input: SendSignInCodeInput
): Promise<SendCodeResult> {
  const { attempt } = await internals.fetchJson<SendCodeResult>({
    method: "POST",
    path: "/sign-in/send-code",
    body: input
  })

  return { attempt }
}

/** `POST /sign-in/code`; the token it returns is stored for every call after. */
export async function signInWithCode(
  internals: AuthClientInternals,
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

/** Input for anonymous sign-in. */
export interface SignInAsGuestInput {
  additionalFields?: Record<string, string | number | boolean>
}

/** `POST /sign-in/guest`; the token it returns is stored for every call after. */
export async function signInAsGuest(
  internals: AuthClientInternals,
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
