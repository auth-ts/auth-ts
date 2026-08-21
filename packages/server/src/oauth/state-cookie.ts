import type { AuthServerInternals } from "../core/auth-server-internals.ts"
import { AuthApiError } from "../http/auth-api-error.ts"
import { decodeBase64url, encodeBase64url } from "../lib/base64url.ts"
import { randomBytesBase64url } from "../lib/generate-random.ts"
import { hmacSha256Hex, timingSafeEqualHex } from "../lib/hash.ts"
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

/**
 * Serializes and signs a state payload: `base64url(json).hmac`.
 *
 * Signed because the cookie is the callback's only memory of how the flow
 * began, and a cookie is writable by more than this server — a sibling
 * subdomain, or script on the page. Without the signature, whatever set it
 * could rewrite `redirect` into a path of their choosing, flip a sign-in into a
 * connect, or add sign-up fields the start endpoint never validated. The HMAC
 * is keyed on `secret`, which nothing outside this process holds.
 */
export async function signStatePayload(
  payload: OAuthStatePayload,
  secret: string
) {
  const encoded = encodeBase64url(JSON.stringify(payload))
  return `${encoded}.${await hmacSha256Hex(encoded, secret)}`
}

/** Verifies a cookie value produced by {@link signStatePayload}; `null` otherwise. */
async function verifyStatePayload(
  value: string,
  secret: string
): Promise<OAuthStatePayload | null> {
  const separator = value.lastIndexOf(".")
  if (separator === -1) return null

  const encoded = value.slice(0, separator)
  const signature = value.slice(separator + 1)
  const expected = await hmacSha256Hex(encoded, secret)
  if (!timingSafeEqualHex(signature, expected)) return null

  const json = decodeBase64url(encoded)
  if (json === null) return null
  try {
    const parsed: unknown = JSON.parse(json)
    return parsed !== null && typeof parsed === "object"
      ? (parsed as OAuthStatePayload)
      : null
  } catch {
    return null
  }
}

/** Builds the state cookie for a flow about to start. */
export async function createStateCookie(
  internals: AuthServerInternals,
  provider: string,
  payload: Omit<OAuthStatePayload, "state">,
  secure: boolean
) {
  const state = randomBytesBase64url(32)
  const setCookie = serializeCookie({
    name: internals.options.cookie.stateName,
    value: await signStatePayload(
      { ...payload, state } satisfies OAuthStatePayload,
      internals.options.secret
    ),
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
 * The signature is checked before anything in the payload is read, so a cookie
 * this server did not write — or one it wrote and something else edited — is
 * indistinguishable from a missing one.
 *
 * @throws {AuthApiError} `unauthenticated` when the cookie is missing, was not
 * signed by this server, or does not match the parameter.
 */
export async function readStateCookie(
  internals: AuthServerInternals,
  headers: Headers,
  stateParameter: string | null
) {
  const raw = readCookie(headers, internals.options.cookie.stateName)
  if (!raw || !stateParameter) throw new AuthApiError("unauthenticated", 401)

  const payload = await verifyStatePayload(raw, internals.options.secret)
  if (!payload) {
    internals.log.warn("oauth state cookie failed signature check")
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
