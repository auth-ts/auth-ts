import type { AuthErrorCode } from "./error-response"

/**
 * The error every endpoint throws when it cannot complete.
 *
 * It exists so the logic never has to know whether it is being called over HTTP
 * or in-process. `createHandler` catches it and serializes the standard
 * envelope; a direct caller catches it and switches on `code`. Either way there
 * is one definition of what went wrong.
 */
export class AuthApiError extends Error {
  /** The stable, machine-readable reason. */
  readonly code: AuthErrorCode
  /** HTTP status the handler should use. */
  readonly status: number
  /** Seconds to wait, for the throttling codes. */
  readonly retryAfter?: number

  constructor(
    code: AuthErrorCode,
    status: number,
    options: { retryAfter?: number; message?: string } = {}
  ) {
    super(options.message ?? code)
    this.name = "AuthApiError"
    this.code = code
    this.status = status
    if (options.retryAfter !== undefined) this.retryAfter = options.retryAfter
  }
}

/** Narrows an unknown caught value to {@link AuthApiError}. */
export function isAuthApiError(error: unknown): error is AuthApiError {
  return error instanceof AuthApiError
}

/** 401 with the `unauthenticated` code — the most common failure by far. */
export function unauthenticated() {
  return new AuthApiError("unauthenticated", 401)
}

/** 404 with the `notFound` code. */
export function notFound() {
  return new AuthApiError("notFound", 404)
}
