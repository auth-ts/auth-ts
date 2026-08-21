import type { AuthServerInternals } from "../core/auth-server-internals.ts"
/**
 * How long a half-finished OAuth flow stays valid.
 *
 * Long enough to sign in at the provider, short enough that an abandoned tab
 * cannot be completed hours later.
 */
export declare const OAUTH_STATE_TTL = "10m"
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
export declare function createStateCookie(
  internals: AuthServerInternals,
  provider: string,
  payload: Omit<OAuthStatePayload, "state">,
  secure: boolean
): {
  state: string
  setCookie: string
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
export declare function readStateCookie(
  internals: AuthServerInternals,
  headers: Headers,
  stateParameter: string | null
): OAuthStatePayload
/** Expires the state cookie once the flow is finished, successfully or not. */
export declare function clearStateCookie(
  internals: AuthServerInternals,
  provider: string,
  secure: boolean
): string
//# sourceMappingURL=state-cookie.d.ts.map
