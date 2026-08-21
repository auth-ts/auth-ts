import type { AuthServerInternals } from "../core/auth-server-internals.ts"
import { AuthApiError } from "../http/auth-api-error.ts"
import { randomBytesBase64url } from "../lib/generate-random.ts"
import { readCookie } from "../lib/parse-cookies.ts"
import { clearCookie, serializeCookie } from "../lib/serialize-cookie.ts"

/**
 * How long a half-finished OAuth flow stays valid.
 *
 * Long enough to sign in at the provider, short enough that an abandoned tab
 * cannot be completed hours later.
 */
export const OAUTH_STATE_TTL = "10m"

/** What the state cookie remembers across the redirect to the provider and back. */
export interface OAuthStatePayload {
  /** The random value echoed back as `?state=` — the CSRF guard. */
  state: string
  /** Whether the callback should sign someone in or link to the current user. */
  intent: "signIn" | "connect"
  /** Validated same-origin path to return to. */
  redirect: string
  /** Locale, carried here because a navigation cannot set `Accept-Language`. */
  locale?: string
  /** Sign-up fields, applied only if the callback creates a user. */
  additionalFields?: Record<string, string | number | boolean>
  /** For `connect`: the user who started the flow, so the callback can require the same one. */
  userId?: string
}

/** Builds the state cookie for a flow about to start. */
export function createStateCookie(
  internals: AuthServerInternals,
  provider: string,
  payload: Omit<OAuthStatePayload, "state">,
  secure: boolean
) {
  const state = randomBytesBase64url(32)
  const setCookie = serializeCookie({
    name: internals.options.cookie.stateName,
    value: JSON.stringify({ ...payload, state } satisfies OAuthStatePayload),
    // Scoped to the exact callback path: this cookie is only ever read there, so
    // there is no reason for it to ride along with anything else.
    path: `${internals.options.basePath}/callback/${provider}`,
    maxAge: OAUTH_STATE_TTL,
    secure
  })

  return { state, setCookie }
}

/**
 * Reads and validates the state cookie against the `?state=` parameter.
 *
 * This is the OAuth CSRF guard, and it is not optional: without it an attacker
 * can hand a victim a callback URL carrying the attacker's own authorization
 * code, and the victim's browser will quietly complete a sign-in as the attacker
 * — or, on a connect flow, link the attacker's provider identity to the victim's
 * account.
 *
 * @throws {AuthApiError} `unauthenticated` when the cookie is missing, unreadable,
 * or does not match the parameter.
 */
export function readStateCookie(
  internals: AuthServerInternals,
  headers: Headers,
  stateParameter: string | null
) {
  const raw = readCookie(headers, internals.options.cookie.stateName)
  if (!raw || !stateParameter) throw new AuthApiError("unauthenticated", 401)

  let payload: OAuthStatePayload
  try {
    payload = JSON.parse(raw) as OAuthStatePayload
  } catch {
    throw new AuthApiError("unauthenticated", 401)
  }

  if (typeof payload.state !== "string" || payload.state !== stateParameter) {
    internals.log.warn("oauth state mismatch")
    throw new AuthApiError("unauthenticated", 401)
  }

  return payload
}

/** Expires the state cookie once the flow is finished, successfully or not. */
export function clearStateCookie(
  internals: AuthServerInternals,
  provider: string,
  secure: boolean
) {
  return clearCookie(
    internals.options.cookie.stateName,
    `${internals.options.basePath}/callback/${provider}`,
    secure
  )
}
