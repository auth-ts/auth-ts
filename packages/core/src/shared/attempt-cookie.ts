import type { VerificationPurpose } from "../core/auth-database"
import type { AuthInternals } from "../core/auth-internals"
import { readCookie } from "../lib/parse-cookies"
import {
  serializeCookie,
  shouldUseSecureCookies
} from "../lib/serialize-cookie"
import { IDENTITY_TTL } from "../verification-code/identity"
import { VERIFICATION_CODE_TTL } from "../verification-code/send-verification-code"

/** What an endpoint that verifies a code may have been handed directly. */
export interface AttemptInput {
  /** The attempt token from the send response, for callers with no cookie jar. */
  attempt?: string
  headers?: Headers
}

const ATTEMPT_COOKIE_NAMES: Record<VerificationPurpose, string> = {
  signIn: "auth-ts.attempt",
  identity: "auth-ts.attempt.identity",
  emailChange: "auth-ts.attempt.email",
  phoneChange: "auth-ts.attempt.phone"
}

/**
 * The cookie that binds a code to the client that requested it, one per purpose.
 *
 * Separate names, because a code requested while an identity check is
 * outstanding must not overwrite the token the check still needs.
 */
export function attemptCookieName(purpose: VerificationPurpose) {
  return ATTEMPT_COOKIE_NAMES[purpose]
}

/**
 * The `Set-Cookie` value carrying an attempt token, scoped to the auth mount.
 *
 * An identity attempt lives as long as the verification it becomes, so the
 * browser still holds it when the marker is checked an hour on.
 */
export function attemptCookie(
  internals: AuthInternals,
  purpose: VerificationPurpose,
  token: string,
  requestURL?: string
) {
  return serializeCookie({
    name: attemptCookieName(purpose),
    value: token,
    path: internals.config.basePath,
    maxAge: purpose === "identity" ? IDENTITY_TTL : VERIFICATION_CODE_TTL,
    secure: shouldUseSecureCookies(requestURL)
  })
}

/** The attempt token a verify request carries, from the body first. */
export function readAttempt(
  input: AttemptInput,
  purpose: VerificationPurpose
): string | null {
  if (input.attempt) return input.attempt
  return input.headers
    ? (readCookie(input.headers, attemptCookieName(purpose)) ?? null)
    : null
}
