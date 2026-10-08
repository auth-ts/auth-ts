import type { AuthErrorCode } from "../../http/error-response"

/**
 * A failure returned by the auth server, as a typed error.
 *
 * Every non-2xx response becomes one of these, so consumers write one `catch`
 * and switch on `code` — a stable string — instead of matching on message text
 * that is localized and free to change.
 */
export class AuthError extends Error {
  /** The stable, machine-readable reason. */
  readonly code: AuthErrorCode
  /** HTTP status, for the rare case it matters. */
  readonly status: number
  /** Seconds to wait, present on `rateLimited`. Render a countdown. */
  readonly retryAfter?: number
  /** Present on `internalError`. Show it so a report can be matched to the server log. */
  readonly requestId?: string

  constructor(
    code: AuthErrorCode,
    status: number,
    message: string,
    retryAfter?: number,
    requestId?: string
  ) {
    super(message)
    this.name = "AuthError"
    this.code = code
    this.status = status
    if (retryAfter !== undefined) this.retryAfter = retryAfter
    if (requestId !== undefined) this.requestId = requestId
  }
}

/**
 * Raised when the network itself failed, as opposed to the server saying no.
 *
 * Kept distinct because the two mean opposite things: a 401 means the session is
 * gone and local state should be cleared, while a dropped connection means
 * nothing about the session and clearing state would sign someone out for
 * walking into a lift.
 */
export class AuthNetworkError extends Error {
  constructor(cause: unknown) {
    super("The authentication request could not be sent.")
    this.name = "AuthNetworkError"
    this.cause = cause
  }
}

/** Narrows an unknown caught value to {@link AuthError}. */
export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError
}
