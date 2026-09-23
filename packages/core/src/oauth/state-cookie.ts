import type { AuthInternals } from "../core/auth-internals"
import { AuthApiError } from "../http/auth-api-error"
import { randomBytesBase64url } from "../lib/generate-random"
import { readCookie } from "../lib/parse-cookies"
import { parseDuration } from "../lib/parse-duration"
import { clearCookie, serializeCookie } from "../lib/serialize-cookie"
import { validateRedirect } from "../lib/validate-redirect"
import { decodeBase64url, encodeBase64url } from "../shared/base64url"
import { codeChallengeS256, createCodeVerifier } from "./pkce"

/**
 * How long a half-finished OAuth flow stays valid.
 *
 * Long enough to sign in at the provider, short enough that an abandoned tab
 * cannot be completed hours later. Enforced twice: as the cookie's `Max-Age`,
 * which a browser honours, and against the `issuedAt` in the payload, which
 * holds for any client at all — a cookie replayed from a jar that does not
 * expire anything is refused here regardless.
 */
const OAUTH_STATE_TTL = "10m"

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
   * a browser courtesy: a sibling subdomain or injected script sets a cookie at
   * any path it likes, so the callback checks the provider itself.
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
  /** Where a failed flow returns to. Falls back to `baseURL`, then to a JSON error. */
  errorRedirect?: string
  /** Sign-up fields, applied only if the callback creates a user. */
  additionalFields?: Record<string, string | number | boolean>
  /** For `connect`: the user who started the flow, so the callback can require the same one. */
  userId?: string
}

/**
 * Serializes a state payload as `base64url(json)`.
 *
 * Not signed. The cookie is the callback's only memory of how the flow began,
 * and a cookie is writable by more than this server — but nothing in it is
 * trusted on its own: the state has to match the provider's echo, the redirect
 * is validated, sign-up fields are checked against the schema, and a connect
 * has to be finished by the session that started it. Whoever can rewrite the
 * cookie already controls the browser it lives in, and gains nothing by it.
 */
export function encodeStatePayload(payload: OAuthStatePayload) {
  return encodeBase64url(JSON.stringify(payload))
}

/** Parses a cookie value produced by {@link encodeStatePayload}; `null` otherwise. */
function decodeStatePayload(value: string): OAuthStatePayload | null {
  const json = decodeBase64url(value)
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
  /** The S256 challenge of the verifier in the cookie. */
  codeChallenge: string
  /** The OIDC nonce in the cookie. */
  nonce: string
  /** The `Set-Cookie` header value. */
  setCookie: string
}

/** Builds the state cookie for a flow about to start. */
export async function createStateCookie(
  internals: AuthInternals,
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
    value: encodeStatePayload({
      ...payload,
      state,
      provider,
      issuedAt: Date.now(),
      codeVerifier,
      nonce
    } satisfies OAuthStatePayload),
    // Path=/ is what earns the __Host- prefix
    path: "/",
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
 * The payload's claims are what is checked: the state must match the
 * parameter, the provider must be this callback's, the flow must be younger
 * than {@link OAUTH_STATE_TTL}, and the PKCE verifier and nonce must be
 * present — a payload without them cannot complete an exchange that requires
 * them. The return paths are validated again here, exactly as the start
 * endpoint validated them, because the cookie could have been edited since.
 * A cookie that does not parse is indistinguishable from a missing one.
 *
 * @throws {AuthApiError} `invalidState` when the cookie is missing or
 * unreadable, does not match the parameter, was issued for a different
 * provider's callback, or has aged out.
 */
export async function readStateCookie(
  internals: AuthInternals,
  headers: Headers,
  stateParameter: string | null,
  provider: string
) {
  const raw =
    readCookie(headers, `__Host-${internals.config.cookie.stateName}`) ??
    readCookie(headers, internals.config.cookie.stateName)
  if (!raw || !stateParameter) throw new AuthApiError("invalidState")

  const payload = decodeStatePayload(raw)
  if (!payload) {
    internals.log.warn("oauth state cookie is unreadable")
    throw new AuthApiError("invalidState")
  }

  if (typeof payload.state !== "string" || payload.state !== stateParameter) {
    internals.log.warn("oauth state mismatch")
    throw new AuthApiError("invalidState")
  }

  if (payload.provider !== provider) {
    internals.log.warn("oauth state presented at another provider's callback")
    throw new AuthApiError("invalidState")
  }

  const age =
    typeof payload.issuedAt === "number" ? Date.now() - payload.issuedAt : NaN
  if (
    !(age <= parseDuration(OAUTH_STATE_TTL)) ||
    age < -ISSUED_AT_TOLERANCE_MS
  ) {
    internals.log.warn("oauth state expired")
    throw new AuthApiError("invalidState")
  }

  if (
    typeof payload.codeVerifier !== "string" ||
    payload.codeVerifier.length === 0 ||
    typeof payload.nonce !== "string" ||
    payload.nonce.length === 0
  ) {
    internals.log.warn("oauth state is missing its verifier or nonce")
    throw new AuthApiError("invalidState")
  }

  if (payload.intent !== "signIn" && payload.intent !== "connect") {
    internals.log.warn("oauth state carries an unknown intent")
    throw new AuthApiError("invalidState")
  }

  return {
    ...payload,
    redirect: validateRedirect(payload.redirect),
    ...(payload.errorRedirect
      ? { errorRedirect: validateRedirect(payload.errorRedirect) }
      : {})
  }
}

/** Expires the state cookie once the flow is finished, successfully or not. */
export function clearStateCookie(internals: AuthInternals, secure: boolean) {
  return clearCookie(internals.config.cookie.stateName, "/", secure)
}
