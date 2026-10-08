/** The HTTP status for each error code. */
export const ERROR_STATUS = {
  /** A rate-limit bucket ran out of tokens. */
  rateLimited: 429,
  /** Expired, already used, for another purpose, or requested by another client. */
  invalidCode: 401,
  /** The code is live and this client's, but not the one that was sent. */
  incorrectCode: 401,
  /** Confirm identity with `sendIdentityCode` and `verifyIdentity`, then retry. */
  verificationRequired: 403,
  /** No session, or a session that no longer resolves. */
  unauthenticated: 401,
  /** That provider identity is already linked to a different user. */
  providerConflict: 409,
  /** The user cancelled at the provider, or it sent no code back. */
  providerDenied: 401,
  /** The provider refused the exchange, or its response did not verify. */
  providerRejected: 401,
  /** The provider has no verified email for this account. */
  providerEmailUnverified: 403,
  /** The state cookie was missing, forged, expired, or for a different flow. */
  invalidState: 401,
  /** A code was requested for a channel this server has no sender for. */
  channelNotConfigured: 400,
  /** A request field was unknown, reserved, or the wrong primitive type. */
  invalidField: 400,
  /** Not lowercase, not one `@` and a dotted domain, or over 100 characters. */
  invalidEmailAddress: 400,
  /** No such route, provider, session, or account. */
  notFound: 404,
  /** The HTTP method is not allowed for this path. */
  methodNotAllowed: 405,
  /** A state-changing request from another origin not in `trustedOrigins`. */
  forbiddenOrigin: 403,
  /** A request body that isn't `application/json`. */
  unsupportedMediaType: 415,
  /** A request body over 16 KiB. */
  payloadTooLarge: 413,
  /** A guest has no email or phone number, so no code can be sent to them. */
  guestCannotReceiveCode: 409,
  /** The address another account already signs in with. */
  emailTaken: 409,
  /** The number another account already signs in with. */
  phoneNumberTaken: 409,
  /** Guest sign-in from a browser where someone is signed in. */
  guestRequiresSignOut: 409,
  /** The OAuth provider timed out or failed while the code was being exchanged. */
  providerUnavailable: 502,
  /** The provider grant is gone. Send the user through `connectProvider` again. */
  providerReconnectRequired: 403,
  /** An unexpected server error. The response carries a `requestId`. */
  internalError: 500
} as const

/** Every failure auth.ts reports. Switch on it, never on the message. */
export type AuthErrorCode = keyof typeof ERROR_STATUS

/**
 * The single shape of every non-2xx JSON body.
 *
 * Flat, with no `error` wrapper: the status code already says this is an
 * error, and no success body shares these keys. Carrying `name` alongside
 * `message` makes the parsed body a complete structural `Error`, so a raw
 * `fetch` caller can `throw await response.json()` straight into anything
 * typed `Error` — an error boundary, TanStack Query — without wrapping it.
 */
export interface AuthErrorBody {
  name: "AuthError"
  code: AuthErrorCode
  /** Human-readable, localized, and free of identifiers and secrets. */
  message: string
  /** Seconds to wait, present on `rateLimited`. */
  retryAfter?: number
  /** Present on `internalError`: quote it to find the log line. */
  requestId?: string
}

/** Builds the JSON error response. `Retry-After` is mirrored into a real header. */
export function errorResponse(
  code: AuthErrorCode,
  status: number,
  message: string,
  options: { retryAfter?: number; headers?: Headers; requestId?: string } = {}
) {
  const headers = new Headers(options.headers)
  headers.set("content-type", "application/json; charset=utf-8")
  if (options.retryAfter !== undefined)
    headers.set("retry-after", String(options.retryAfter))

  const body: AuthErrorBody = {
    name: "AuthError",
    code,
    message,
    ...(options.retryAfter === undefined
      ? {}
      : { retryAfter: options.retryAfter }),
    ...(options.requestId === undefined ? {} : { requestId: options.requestId })
  }

  return new Response(JSON.stringify(body), { status, headers })
}
