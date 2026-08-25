import type { AuthUser } from "@auth-ts/server"
import type { AuthClientInternals } from "../core/auth-client-internals"

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

/**
 * Verifies a code and starts a session.
 *
 * The token comes back with the user and is stored on the way through, so the
 * sign-in and the first render cost one round trip between them rather than a
 * sign-in followed by a refresh.
 */
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
    internals.tokenStore.set(result.token)

    return result
  }
}
