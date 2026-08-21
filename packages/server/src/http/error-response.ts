/**
 * Every failure this library can report, as a stable string.
 *
 * These values are the contract: clients switch on `code`, never on `message`.
 * Messages are localized and may be reworded at any time; codes are English
 * forever and are only ever added to.
 */
export type AuthErrorCode =
  /** A send was attempted before the per-identifier cooldown elapsed. */
  | "cooldown"
  /** A fixed-window rate limit was exceeded. */
  | "rateLimited"
  /** Wrong, expired, already-used, or wrong-purpose magic code. */
  | "invalidCode"
  /** Deletion needs confirmation; a code has been sent. */
  | "codeSent"
  /** The session is too old for this action without re-proving identity. */
  | "staleSession"
  /** No session, or a session that no longer resolves. */
  | "unauthenticated"
  /** Removing this provider would leave no way to sign in. */
  | "lastSignInMethod"
  /** That provider identity is already linked to a different user. */
  | "providerConflict"
  /** A code was requested for a channel this server has no sender for. */
  | "channelNotConfigured"
  /** A request field was unknown, reserved, or the wrong primitive type. */
  | "invalidField"
  /** No such route, provider, session, or account. */
  | "notFound"
  /** The HTTP method is not allowed for this path. */
  | "methodNotAllowed"
  /** A guest has no email or phone number, so no code can be sent to them. */
  | "guestCannotReceiveCode"
  /** The OAuth provider timed out or failed while the code was being exchanged. */
  | "providerUnavailable"
  /** Something threw that this library did not anticipate. */
  | "internalError"

/** The single shape of every non-2xx JSON body. */
export interface AuthErrorBody {
  error: {
    code: AuthErrorCode
    /** Human-readable, localized, and free of identifiers and secrets. */
    message: string
    /** Seconds to wait, present on `cooldown` and `rateLimited`. */
    retryAfter?: number
  }
}

/** Builds the JSON error response. `Retry-After` is mirrored into a real header. */
export function errorResponse(
  code: AuthErrorCode,
  status: number,
  message: string,
  options: { retryAfter?: number; headers?: Headers } = {}
) {
  const headers = new Headers(options.headers)
  headers.set("content-type", "application/json")
  if (options.retryAfter !== undefined)
    headers.set("retry-after", String(options.retryAfter))

  const body: AuthErrorBody = {
    error: {
      code,
      message,
      ...(options.retryAfter === undefined
        ? {}
        : { retryAfter: options.retryAfter })
    }
  }

  return new Response(JSON.stringify(body), { status, headers })
}
