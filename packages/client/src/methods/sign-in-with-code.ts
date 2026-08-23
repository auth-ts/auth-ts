import type { AuthUser } from "@auth-ts/server"
import type { AuthClientInternals } from "../core/auth-client-internals"

/** Exactly one identifier: whichever you pass selects the channel. */
export type SendCodeInput =
  | { email: string; phoneNumber?: never }
  | { phoneNumber: string; email?: never }

/** The identifier, the code, and any declared sign-up fields. */
export type VerifyCodeInput = SendCodeInput & {
  code: string
  /** Applied only if this verification creates the account. */
  additionalFields?: Record<string, string | number | boolean>
}

/** What a completed sign-in returns. The token arrived in the response header. */
export interface SignInResult {
  user: AuthUser
}

/**
 * Requests a sign-in code.
 *
 * Always succeeds for a well-formed address, whether or not an account exists —
 * the server has nothing to reveal, since the account is created at verification.
 *
 * @throws {AuthError} `cooldown` or `rateLimited`, both carrying `retryAfter`.
 * Render the countdown rather than only disabling the button; "try again later"
 * with no number is the most annoying error message in software.
 */
export function createSendCode(internals: AuthClientInternals) {
  return async function sendCode(input: SendCodeInput): Promise<void> {
    await internals.fetchJson({
      method: "POST",
      path: "/send-code",
      body: input
    })
  }
}

/**
 * Verifies a code and starts a session.
 *
 * The token rides back in the response header and is stored on the way through,
 * so the sign-in and the first render cost one round trip between them.
 */
export function createVerifyCode(internals: AuthClientInternals) {
  return async function verifyCode(
    input: VerifyCodeInput
  ): Promise<SignInResult> {
    const result = await internals.fetchJson<SignInResult>({
      method: "POST",
      path: "/verify-code",
      body: input
    })
    return result
  }
}

/** Input for anonymous sign-in. */
export interface SignInAsGuestInput {
  additionalFields?: Record<string, string | number | boolean>
}

/**
 * Signs in anonymously.
 *
 * Available only when the server sets `guest: true`. The resulting user is real
 * in every way that matters — they own rows, they have a session — which is what
 * lets them keep everything when they later add an email or connect a provider.
 */
export function createSignInAsGuest(internals: AuthClientInternals) {
  return async function signInAsGuest(
    input: SignInAsGuestInput = {}
  ): Promise<SignInResult> {
    const result = await internals.fetchJson<SignInResult>({
      method: "POST",
      path: "/sign-in/guest",
      body: input
    })
    return result
  }
}
