import { createRemoteJWKSet, errors, jwtVerify } from "jose"
import { AuthApiError } from "../../http/auth-api-error"
import type {
  AuthorizeURLInput,
  ExchangeCodeInput,
  OAuthProvider,
  ProviderIdentity
} from "./oauth-provider"
import { providerRejected } from "./provider-response"

interface GoogleIdTokenClaims {
  sub?: string
  email?: string
  email_verified?: boolean
  name?: string
  picture?: string
  nonce?: string
}

/** Both forms Google has issued as `iss`; the OIDC discovery document lists the first. */
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"]

/**
 * Google's signing keys, fetched on first use and cached by jose.
 *
 * Module-level so the cache outlives a request: jose refetches only when a
 * token arrives with a `kid` it has not seen (with a cooldown), which is how
 * key rotation is absorbed. The timeout is shorter than the callback's own
 * deadline, so a stalled JWKS is reported as the provider being unreachable
 * rather than as the whole request timing out.
 */
const googleKeys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
  { timeoutDuration: 5_000 }
)

/**
 * Google sign-in, via the standard OIDC authorization code flow.
 *
 * PKCE on the code exchange and a nonce bound into the ID token, both carried
 * in the signed state cookie across the redirect.
 */
export const google: OAuthProvider = {
  id: "google",

  authorizeURL({
    credentials,
    redirectURI,
    state,
    codeChallenge,
    nonce
  }: AuthorizeURLInput) {
    const parameters = new URLSearchParams({
      client_id: credentials.clientId,
      redirect_uri: redirectURI,
      response_type: "code",
      scope: "openid email profile",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      nonce
    })

    return `https://accounts.google.com/o/oauth2/v2/auth?${parameters.toString()}`
  },

  async exchangeCode({
    credentials,
    redirectURI,
    code,
    codeVerifier,
    nonce,
    signal
  }: ExchangeCodeInput): Promise<ProviderIdentity> {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        redirect_uri: redirectURI,
        grant_type: "authorization_code",
        code,
        code_verifier: codeVerifier
      }),
      signal
    })

    if (!tokenResponse.ok) throw providerRejected(tokenResponse)
    const token = (await tokenResponse.json().catch(() => ({}))) as {
      id_token?: string
    }
    if (!token.id_token) throw new AuthApiError("unauthenticated", 401)

    // Verified in full — signature against Google's published keys, issuer,
    // audience, and expiry — even though the token just arrived over TLS from
    // Google's own endpoint. The transport argues for provenance; the
    // verification proves it, and also catches the mundane failures the
    // transport cannot: a token minted for a different client id, or one that
    // has already expired.
    //
    // `exp`, `iat`, and `sub` are required, not merely checked when present:
    // jose validates an expiry it finds but accepts a token without one, and
    // an OIDC ID token without any of the three is not one Google issued. The
    // same 60 s tolerance as this library's own verifier, for the same reason.
    let claims: GoogleIdTokenClaims
    try {
      const verified = await jwtVerify(token.id_token, googleKeys, {
        algorithms: ["RS256"],
        issuer: GOOGLE_ISSUERS,
        audience: credentials.clientId,
        requiredClaims: ["exp", "iat", "sub"],
        clockTolerance: "60s"
      })
      claims = verified.payload as GoogleIdTokenClaims
    } catch (error) {
      throw classifyVerifyFailure(error)
    }
    if (!claims.sub) throw new AuthApiError("unauthenticated", 401)

    // The nonce ties this token to this flow: it went out in the authorize
    // request and must come back in the token, or the token was minted for
    // some other request and is being replayed into this one.
    if (claims.nonce !== nonce) throw new AuthApiError("unauthenticated", 401)

    // Same stakes as GitHub: an unverified address is an account takeover waiting
    // to happen, so it is dropped rather than trusted.
    const email = claims.email_verified === true ? claims.email : undefined

    return {
      providerUserId: claims.sub,
      ...(email ? { label: email.toLowerCase() } : {}),
      ...(email ? { email: email.toLowerCase() } : {}),
      ...(claims.name ? { name: claims.name } : {}),
      ...(claims.picture ? { imageURL: claims.picture } : {})
    }
  }
}

/**
 * Separates "Google could not be reached" from "this token does not check out".
 *
 * A JWKS timeout, a non-200 from the key endpoint, or a network error is the
 * provider being unavailable. Everything jose says about the token itself — bad
 * signature, wrong audience, expired, unknown key — is a refusal.
 */
function classifyVerifyFailure(error: unknown) {
  const unreachable =
    !(error instanceof errors.JOSEError) ||
    error instanceof errors.JWKSTimeout ||
    error.code === "ERR_JOSE_GENERIC"

  return unreachable
    ? new AuthApiError("providerUnavailable", 502)
    : new AuthApiError("unauthenticated", 401)
}
