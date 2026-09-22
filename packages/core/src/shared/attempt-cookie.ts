import type { VerificationPurpose } from "../core/auth-database"
import type { AuthInternals } from "../core/auth-internals"
import { readCookie } from "../lib/parse-cookies"
import {
  serializeCookie,
  shouldUseSecureCookies
} from "../lib/serialize-cookie"
import { VERIFICATION_CODE_TTL } from "../verification-code/send-verification-code"

/** What an endpoint that verifies a code may have been handed directly. */
export interface AttemptInput {
  /** The attempt token from the send response, for callers with no cookie jar. */
  attempt?: string
  headers?: Headers
}

/**
 * The cookie that binds a code to the client that requested it, one per purpose.
 *
 * Separate names, because a sign-in code requested while a deletion code is
 * outstanding must not overwrite the token the deletion still needs.
 */
export function attemptCookieName(purpose: VerificationPurpose) {
  return purpose === "signIn" ? "auth-ts.attempt" : "auth-ts.attempt.delete"
}

/** The `Set-Cookie` value carrying an attempt token, scoped to the auth mount. */
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
    maxAge: VERIFICATION_CODE_TTL,
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
