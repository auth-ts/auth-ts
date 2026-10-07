import type { AuthUser } from "../../core/auth-database"
import type { AuthClientInternals } from "../core/auth-client-internals"
import { AuthError } from "../lib/auth-error"
import { reviveUser } from "../lib/revive-user"
import { currentAttempt, rememberAttempt } from "../lib/session-storage"

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
  const generation = internals.tokenStore.generation()
  const { attempt } = await internals.fetchJson<SendCodeResult>({
    method: "POST",
    path: "/sign-in/send-code",
    body: input
  })

  if (internals.tokenStore.generation() === generation)
    rememberAttempt(internals, "signIn", attempt)
  return { attempt }
}

/** `POST /sign-in/code`; the token it returns is stored for every call after. */
export async function signInWithCode(
  internals: AuthClientInternals,
  input: SignInWithCodeInput
): Promise<SignInResult> {
  if (internals.sessionStore && (await internals.sessionStore.read()).active) {
    try {
      await internals.requireToken()
    } catch (error) {
      if (!(error instanceof AuthError && error.code === "unauthenticated"))
        throw error
    }
  }
  return completeSignIn(internals, "/sign-in/code", {
    ...input,
    ...(input.attempt ? {} : { attempt: currentAttempt(internals, "signIn") })
  })
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
  if (internals.sessionStore && (await internals.sessionStore.read()).active)
    await internals.requireToken()
  return completeSignIn(internals, "/sign-in/guest", input)
}

async function completeSignIn(
  internals: AuthClientInternals,
  path: string,
  body: unknown
): Promise<SignInResult> {
  const generation = internals.tokenStore.invalidate()
  const result = await internals.fetchJson<
    SignInResult & { sessionToken?: string; multiUser?: boolean }
  >({ method: "POST", path: `${path}`, body })
  const user = reviveUser(result.user)
  if (internals.tokenStore.generation() !== generation) {
    if (result.sessionToken)
      await internals.fetchJson({
        method: "POST",
        path: "/sign-out",
        body: {},
        bearer: result.token
      })
    throw new Error("The sign-in was superseded by an account change.")
  }
  if (internals.sessionStore) {
    if (!result.sessionToken || typeof result.multiUser !== "boolean")
      throw new Error("The server did not return a native session credential.")
    const previous = await internals.sessionStore.read()
    const stored = await internals.sessionStore.put(
      user.id,
      result.sessionToken,
      result.multiUser,
      () => internals.tokenStore.generation() === generation
    )
    if (!stored) {
      await internals.fetchJson({
        method: "POST",
        path: "/sign-out",
        body: {},
        bearer: result.token
      })
      throw new Error("The sign-in was superseded by an account change.")
    }
    if (internals.tokenStore.generation() !== generation)
      throw new Error("The sign-in was superseded by an account change.")
    internals.tokenStore.set(result.token)
    if (!result.multiUser) {
      for (const [id, credential] of Object.entries(previous.accounts)) {
        if (id === user.id) continue
        try {
          const old = await internals.exchangeSession(credential)
          if (old)
            await internals.fetchJson({
              method: "POST",
              path: "/sign-out",
              body: {},
              bearer: old.token
            })
          await internals.sessionStore.remove(id, credential)
        } catch {
          internals.log.warn("Superseded session revocation could not complete")
        }
      }
    }
  }
  if (internals.tokenStore.generation() !== generation)
    throw new Error("The sign-in was superseded by an account change.")
  internals.attempts = {}
  if (!internals.sessionStore) internals.tokenStore.set(result.token)
  return { user, token: internals.tokenStore.get()?.token ?? result.token }
}
