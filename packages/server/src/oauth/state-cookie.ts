import type { AuthServerInternals } from "../core/auth-server-internals.ts"
import { AuthApiError } from "../http/auth-api-error.ts"
import { decodeBase64url, encodeBase64url } from "../lib/base64url.ts"
import { randomBytesBase64url } from "../lib/generate-random.ts"
import { hmacSha256Hex, timingSafeEqualHex } from "../lib/hash.ts"
import { readCookie } from "../lib/parse-cookies.ts"
import { parseDuration } from "../lib/parse-duration.ts"
import { clearCookie, serializeCookie } from "../lib/serialize-cookie.ts"
import { codeChallengeS256, createCodeVerifier } from "./pkce.ts"

/**
 * How long a half-finished OAuth flow stays valid.
 *
 * Long enough to sign in at the provider, short enough that an abandoned tab
 * cannot be completed hours later. Enforced twice: as the cookie's `Max-Age`,
 * which a browser honours, and against the `issuedAt` signed into the payload,
 * which holds for any client at all — a cookie replayed from a jar that does
 * not expire anything is refused here regardless.
 */
export const OAUTH_STATE_TTL = "10m"

/**
 * How far ahead of this server's clock a state may claim to have been issued.
 *
 * The same tolerance the token verifiers use, for the same reason: two hosts
 * behind one load balancer rarely agree on the second, and a state minted on
 * the one that runs slightly fast must not be refused by the one that does not.
 */
const ISSUED_AT_TOLERANCE_MS = 60_000

/** What the state cookie remembers across the redirect to the provider and back. */
export interface OAuthStatePayload {
  /** The random value echoed back as `?state=` — the CSRF guard. */
  state: string
  /**
   * The provider the flow started against, so the cookie completes only that
   * provider's callback. The cookie is already path-scoped to it, but a path is
   * a browser courtesy, not a boundary against the writer the signature guards
   * against — a sibling subdomain or injected script sets a cookie at any path
   * it likes. Signing the provider in is what makes a provider-A cookie
   * worthless at provider B's callback, whatever intent or redirect it carries.
   */
  provider: string
  /** Whether the callback should sign someone in or link to the current user. */
  intent: "signIn" | "connect"
  /** Validated same-origin path to return to. */
  redirect: string
  /**
   * When the flow started, epoch milliseconds. The callback refuses a payload
   * older than {@link OAUTH_STATE_TTL} whether or not the browser still had
   * the cookie — the lifetime is this server's rule, not the cookie jar's.
   */
  issuedAt: number
  /**
   * The PKCE code verifier, sent to the provider's token endpoint at the
   * callback. Only its S256 challenge ever travels through the browser.
   */
  codeVerifier: string
  /**
   * The OIDC nonce, for providers that return an ID token. Bound into the
   * authorize request and required to reappear in the token, so a token minted
   * for some other flow cannot complete this one.
   */
  nonce: string
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

/** What starting a flow produced: the cookie, and the values the authorize URL carries. */
export interface StateCookie {
  /** The `?state=` value. */
  state: string
  /** The S256 challenge of the verifier signed into the cookie. */
  codeChallenge: string
  /** The OIDC nonce signed into the cookie. */
  nonce: string
  /** The `Set-Cookie` header value. */
  setCookie: string
}

/** Builds the state cookie for a flow about to start. */
export async function createStateCookie(
  internals: AuthServerInternals,
  provider: string,
  payload: Omit<
    OAuthStatePayload,
    "state" | "provider" | "issuedAt" | "codeVerifier" | "nonce"
  >,
  secure: boolean
): Promise<StateCookie> {
  const state = randomBytesBase64url(32)
  const codeVerifier = createCodeVerifier()
  const nonce = randomBytesBase64url(32)
  const setCookie = serializeCookie({
    name: internals.config.cookie.stateName,
    value: await signStatePayload(
      {
        ...payload,
        state,
        provider,
        issuedAt: Date.now(),
        codeVerifier,
        nonce
      } satisfies OAuthStatePayload,
      internals.config.secret
    ),
    // Scoped to the exact callback path: this cookie is only ever read there, so
    // there is no reason for it to ride along with anything else.
    path: `${internals.config.basePath}/callback/${provider}`,
    maxAge: OAUTH_STATE_TTL,
    secure
  })

  return {
    state,
    codeChallenge: await codeChallengeS256(codeVerifier),
    nonce,
    setCookie
  }
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
 * indistinguishable from a missing one. Then the payload's own claims: the
 * state must match the parameter, the provider must be this callback's, the
 * flow must be younger than {@link OAUTH_STATE_TTL}, and the PKCE verifier and
 * nonce must be present — a payload without them was not written by this
 * version of the server and cannot complete an exchange that requires them.
 *
 * @throws {AuthApiError} `unauthenticated` when the cookie is missing, was not
 * signed by this server, does not match the parameter, was issued for a
 * different provider's callback, or has aged out.
 */
export async function readStateCookie(
  internals: AuthServerInternals,
  headers: Headers,
  stateParameter: string | null,
  provider: string
) {
  const raw = readCookie(headers, internals.config.cookie.stateName)
  if (!raw || !stateParameter) throw new AuthApiError("unauthenticated", 401)

  const payload = await verifyStatePayload(raw, internals.config.secret)
  if (!payload) {
    internals.log.warn("oauth state cookie failed signature check")
    throw new AuthApiError("unauthenticated", 401)
  }

  if (typeof payload.state !== "string" || payload.state !== stateParameter) {
    internals.log.warn("oauth state mismatch")
    throw new AuthApiError("unauthenticated", 401)
  }

  if (payload.provider !== provider) {
    internals.log.warn("oauth state presented at another provider's callback")
    throw new AuthApiError("unauthenticated", 401)
  }

  const age =
    typeof payload.issuedAt === "number" ? Date.now() - payload.issuedAt : NaN
  if (
    !(age <= parseDuration(OAUTH_STATE_TTL)) ||
    age < -ISSUED_AT_TOLERANCE_MS
  ) {
    internals.log.warn("oauth state expired")
    throw new AuthApiError("unauthenticated", 401)
  }

  if (
    typeof payload.codeVerifier !== "string" ||
    payload.codeVerifier.length === 0 ||
    typeof payload.nonce !== "string" ||
    payload.nonce.length === 0
  ) {
    internals.log.warn("oauth state is missing its verifier or nonce")
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
    internals.config.cookie.stateName,
    `${internals.config.basePath}/callback/${provider}`,
    secure
  )
}
