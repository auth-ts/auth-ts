import type { AuthUser } from "../../core/auth-database"
import type { AuthClientInternals } from "../core/auth-client-internals"
import { AuthError } from "../lib/auth-error"
import { reviveUser } from "../lib/revive-user"
import { currentAttempt, rememberAttempt } from "../lib/session-storage"
import type { SendCodeResult } from "./sign-in"

/** The flat body accepted by profile updates. */
export type UpdateUserInput = {
  name?: string
  image?: string
} & Record<string, string | number | boolean | undefined>

/** `POST /user`: the signed-in user, as stored after the update. */
export async function updateUser(
  internals: AuthClientInternals,
  input: UpdateUserInput
): Promise<AuthUser> {
  const user = await internals.fetchJson<AuthUser>({
    method: "POST",
    path: "/user",
    body: input,
    authenticated: true
  })
  return reviveUser(user)
}

/** How far a sign-out reaches, for each account it applies to. */
export type SignOutScope = "local" | "global"

/** Input for signing out. */
export interface SignOutInput {
  /**
   * `local` ends this browser's session; `global` ends every session of the user.
   * @default "local"
   */
  scope?: SignOutScope
  /** One user to sign out, under `multiUser`. Omit it to sign out everyone here. */
  userId?: string
}

/** `POST /sign-out`, then forgets the token. */
export async function signOut(
  internals: AuthClientInternals,
  input: SignOutInput = {}
): Promise<void> {
  const scope = input.scope ?? "local"
  const generation = internals.sessionStore
    ? internals.tokenStore.invalidate()
    : internals.tokenStore.generation()
  if (internals.sessionStore) {
    const stored = await internals.sessionStore.read()
    const targets = Object.entries(stored.accounts).filter(
      ([id]) => input.userId === undefined || id === input.userId
    )
    if (input.userId !== undefined && !targets.length)
      throw new AuthError("notFound", 404, "No such signed-in account.")
    for (const [id, credential] of targets) {
      const result = await internals.exchangeSession(credential)
      if (result)
        await internals.fetchJson({
          method: "POST",
          path: "/sign-out",
          body: { scope },
          bearer: result.token
        })
      await internals.sessionStore.remove(id, credential)
    }
    if (
      internals.tokenStore.generation() === generation &&
      (input.userId === undefined || input.userId === stored.active)
    ) {
      internals.tokenStore.clear()
      internals.attempts = {}
    }
    return
  }
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

  if (internals.tokenStore.generation() === generation) {
    internals.tokenStore.invalidate()
    internals.tokenStore.clear()
  }
}

/** Where no cookie carries it, the attempt token `sendIdentityCode` returned. */
export interface IdentityAttemptInput {
  attempt?: string
}

/** What a verified action resolved to. */
export interface VerifiedActionResult<Done extends string> {
  /** `"verificationRequired"` means call `sendIdentityCode`, then `verifyIdentity`, and retry. */
  status: Done | "verificationRequired"
}

/** Input for account deletion. */
export type DeleteUserInput = IdentityAttemptInput

/** What a deletion attempt resolved to. */
export type DeleteUserResult = VerifiedActionResult<"deleted">

/** Input for revoking one of the user's sessions. */
export interface RevokeSessionInput extends IdentityAttemptInput {
  /** The session's id, from your `sessions` table. */
  id: string
}

/** What a revocation attempt resolved to. */
export type RevokeSessionResult = VerifiedActionResult<"revoked">

/** Input for verifying identity. */
export interface VerifyIdentityInput extends IdentityAttemptInput {
  code: string
}

/** Runs a verified action, reporting the challenge as a result rather than an error. */
async function verifiedAction(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run()
    return true
  } catch (error) {
    if (error instanceof AuthError && error.code === "verificationRequired")
      return false
    throw error
  }
}

/** `DELETE /user`; the verification challenge is reported as a result, not thrown. */
export async function deleteUser(
  internals: AuthClientInternals,
  input: DeleteUserInput = {}
): Promise<DeleteUserResult> {
  if (internals.sessionStore) await internals.requireToken()
  const identity = input.attempt ?? currentAttempt(internals, "identity")
  const stored = await internals.sessionStore?.read()
  const generation = internals.tokenStore.generation()
  const deleted = await verifiedAction(() =>
    internals.fetchJson({
      method: "DELETE",
      path: "/user",
      body: { ...input, ...(identity ? { attempt: identity } : {}) },
      authenticated: true
    })
  )
  if (!deleted) return { status: "verificationRequired" }

  const credential = stored?.active && stored.accounts[stored.active]
  if (stored?.active && credential)
    await internals.sessionStore?.remove(stored.active, credential)
  if (internals.tokenStore.generation() === generation) {
    internals.tokenStore.invalidate()
    internals.tokenStore.clear()
    internals.attempts = {}
  }

  return { status: "deleted" }
}

/** `DELETE /sessions/:id`; the verification challenge is reported as a result, not thrown. */
export async function revokeSession(
  internals: AuthClientInternals,
  { id, ...body }: RevokeSessionInput
): Promise<RevokeSessionResult> {
  if (internals.sessionStore) await internals.requireToken()
  const attempt = body.attempt ?? currentAttempt(internals, "identity")
  const revoked = await verifiedAction(() =>
    internals.fetchJson({
      method: "DELETE",
      path: `/sessions/${encodeURIComponent(id)}`,
      body: { ...body, ...(attempt ? { attempt } : {}) },
      authenticated: true
    })
  )

  return { status: revoked ? "revoked" : "verificationRequired" }
}

/** Input for sending a code to a new email address. */
export interface SendEmailUpdateCodeInput extends IdentityAttemptInput {
  /** The new address. */
  email: string
}

/** Input for sending a code to a new phone number. */
export interface SendPhoneUpdateCodeInput extends IdentityAttemptInput {
  /** The new number, E.164. */
  phoneNumber: string
}

/** What sending the code resolved to; `attempt` rides along once sent. */
export type SendUpdateCodeResult =
  | { status: "sent"; attempt: string }
  | { status: "verificationRequired" }

/** The tokens a verify carries where no cookie does. */
export interface VerifyUpdateInput {
  code: string
  /** The attempt token the send returned. */
  attempt?: string
  /** The attempt token `sendIdentityCode` returned. */
  identityAttempt?: string
}

/** What the change resolved to; the user carries the new identifier once updated. */
export type VerifyUpdateResult =
  | { status: "updated"; user: AuthUser }
  | { status: "verificationRequired" }

async function sendUpdateCode(
  internals: AuthClientInternals,
  route: string,
  body: unknown
): Promise<SendUpdateCodeResult> {
  if (internals.sessionStore) await internals.requireToken()
  const input = body as { attempt?: string }
  const identity = input.attempt ?? currentAttempt(internals, "identity")
  const generation = internals.tokenStore.generation()
  let attempt = ""
  const sent = await verifiedAction(async () => {
    ;({ attempt } = await internals.fetchJson<SendCodeResult>({
      method: "POST",
      path: `/user/${route}/send-code`,
      body: { ...input, ...(identity ? { attempt: identity } : {}) },
      authenticated: true
    }))
  })

  if (sent && internals.tokenStore.generation() === generation)
    rememberAttempt(
      internals,
      route === "update-email" ? "emailChange" : "phoneChange",
      attempt
    )
  return sent ? { status: "sent", attempt } : { status: "verificationRequired" }
}

async function verifyUpdate(
  internals: AuthClientInternals,
  route: string,
  body: unknown
): Promise<VerifyUpdateResult> {
  if (internals.sessionStore) await internals.requireToken()
  const input = body as VerifyUpdateInput
  const purpose = route === "update-email" ? "emailChange" : "phoneChange"
  const attempt = input.attempt ?? currentAttempt(internals, purpose)
  const identityAttempt =
    input.identityAttempt ?? currentAttempt(internals, "identity")
  let user: AuthUser | undefined
  const updated = await verifiedAction(async () => {
    user = await internals.fetchJson<AuthUser>({
      method: "POST",
      path: `/user/${route}/verify`,
      body: {
        ...input,
        ...(attempt ? { attempt } : {}),
        ...(identityAttempt ? { identityAttempt } : {})
      },
      authenticated: true
    })
  })

  if (updated) delete internals.attempts[purpose]
  return updated && user
    ? { status: "updated", user: reviveUser(user) }
    : { status: "verificationRequired" }
}

/** `POST /user/update-email/send-code`; the verification challenge is reported as a result, not thrown. */
export const sendEmailUpdateCode = (
  internals: AuthClientInternals,
  input: SendEmailUpdateCodeInput
) => sendUpdateCode(internals, "update-email", input)

/** `POST /user/update-email/verify`; the verification challenge is reported as a result, not thrown. */
export const verifyEmailUpdate = (
  internals: AuthClientInternals,
  input: VerifyUpdateInput
) => verifyUpdate(internals, "update-email", input)

/** `POST /user/update-phone/send-code`; the verification challenge is reported as a result, not thrown. */
export const sendPhoneUpdateCode = (
  internals: AuthClientInternals,
  input: SendPhoneUpdateCodeInput
) => sendUpdateCode(internals, "update-phone", input)

/** `POST /user/update-phone/verify`; the verification challenge is reported as a result, not thrown. */
export const verifyPhoneUpdate = (
  internals: AuthClientInternals,
  input: VerifyUpdateInput
) => verifyUpdate(internals, "update-phone", input)

/** `POST /user/verify/send-code`. */
export async function sendIdentityCode(
  internals: AuthClientInternals
): Promise<SendCodeResult> {
  if (internals.sessionStore) await internals.requireToken()
  const generation = internals.tokenStore.generation()
  const { attempt } = await internals.fetchJson<SendCodeResult>({
    method: "POST",
    path: "/user/verify/send-code",
    authenticated: true
  })

  if (internals.tokenStore.generation() === generation)
    rememberAttempt(internals, "identity", attempt)
  return { attempt }
}

/** `POST /user/verify`. */
export async function verifyIdentity(
  internals: AuthClientInternals,
  input: VerifyIdentityInput
): Promise<void> {
  if (internals.sessionStore) await internals.requireToken()
  const attempt = input.attempt ?? currentAttempt(internals, "identity")
  const generation = internals.tokenStore.generation()
  await internals.fetchJson({
    method: "POST",
    path: "/user/verify",
    body: { ...input, ...(attempt ? { attempt } : {}) },
    authenticated: true
  })
  if (attempt && internals.tokenStore.generation() === generation)
    rememberAttempt(internals, "identity", attempt, true)
}
