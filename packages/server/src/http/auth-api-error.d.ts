import type { AuthErrorCode } from "./error-response.ts"
/**
 * The error every endpoint throws when it cannot complete.
 *
 * It exists so the logic never has to know whether it is being called over HTTP
 * or in-process. `createHandler` catches it and serializes the standard
 * envelope; a direct caller catches it and switches on `code`. Either way there
 * is one definition of what went wrong.
 */
export declare class AuthApiError extends Error {
  /** The stable, machine-readable reason. */
  readonly code: AuthErrorCode
  /** HTTP status the handler should use. */
  readonly status: number
  /** Seconds to wait, for the throttling codes. */
  readonly retryAfter?: number
  constructor(
    code: AuthErrorCode,
    status: number,
    options?: {
      retryAfter?: number
      message?: string
    }
  )
}
/** Narrows an unknown caught value to {@link AuthApiError}. */
export declare function isAuthApiError(error: unknown): error is AuthApiError
/** 401 with the `unauthenticated` code — the most common failure by far. */
export declare function unauthenticated(): AuthApiError
/** 404 with the `notFound` code. */
export declare function notFound(): AuthApiError
//# sourceMappingURL=auth-api-error.d.ts.map
