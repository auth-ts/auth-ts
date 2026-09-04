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
  /** Wrong, expired, already-used, or for a different purpose. */
  | "invalidCode"
  /** The session is too old for this action without re-proving identity. */
  | "staleSession"
  /** No session, or a session that no longer resolves. */
  | "unauthenticated"
  /** That provider identity is already linked to a different user. */
  | "providerConflict"
  /** The provider reported a failure, or sent no code back — usually a cancelled consent. */
  | "providerDenied"
  /** The provider refused the exchange, or its response did not verify. */
  | "providerRejected"
  /** The provider has no verified email address for the account, so it cannot identify one. */
  | "providerEmailUnverified"
  /** The state cookie was missing, forged, expired, or for a different flow. */
  | "invalidState"
  /** A code was requested for a channel this server has no sender for. */
  | "channelNotConfigured"
  /** A request field was unknown, reserved, or the wrong primitive type. */
  | "invalidField"
  /** No such route, provider, session, or account. */
  | "notFound"
  /** The HTTP method is not allowed for this path. */
  | "methodNotAllowed"
  /** A state-changing request came from an origin this server does not serve. */
  | "forbiddenOrigin"
  /** A request body was sent with a content type other than `application/json`. */
  | "unsupportedMediaType"
  /** A guest has no email or phone number, so no code can be sent to them. */
  | "guestCannotReceiveCode"
  /**
   * A guest sign-in was attempted from a browser that is signed in. Guests
   * need a signed-out browser — under `multiUser` more sign-ins are
   * welcome, so the refusal is about the guest, not about being signed in.
   */
  | "guestRequiresSignOut"
  /** The OAuth provider timed out or failed while the code was being exchanged. */
  | "providerUnavailable"
  /**
   * The stored grant for a linked provider cannot produce an access token any
   * more — never issued, expired, or revoked at the provider. Only reconnecting
   * fixes it, so it is not `unauthenticated`: the session here is perfectly fine.
   */
  | "providerReconnectRequired"
  /** Something threw that this library did not anticipate. */
  | "internalError"

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
  /** Seconds to wait, present on `cooldown` and `rateLimited`. */
  retryAfter?: number
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
    name: "AuthError",
    code,
    message,
    ...(options.retryAfter === undefined
      ? {}
      : { retryAfter: options.retryAfter })
  }

  return new Response(JSON.stringify(body), { status, headers })
}
