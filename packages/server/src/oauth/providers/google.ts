import { decodeJwt } from "jose"
import { AuthApiError } from "../../http/auth-api-error.ts"
import type {
  AuthorizeURLInput,
  ExchangeCodeInput,
  OAuthProvider,
  ProviderIdentity
} from "./oauth-provider.ts"

interface GoogleIdTokenClaims {
  sub?: string
  email?: string
  email_verified?: boolean
  name?: string
  picture?: string
}

/**
 * Google sign-in, via the standard OIDC authorization code flow.
 */
export const google: OAuthProvider = {
  id: "google",

  authorizeURL({ credentials, redirectURI, state }: AuthorizeURLInput) {
    const parameters = new URLSearchParams({
      client_id: credentials.clientId,
      redirect_uri: redirectURI,
      response_type: "code",
      scope: "openid email profile",
      state
    })

    return `https://accounts.google.com/o/oauth2/v2/auth?${parameters.toString()}`
  },

  async exchangeCode({
    credentials,
    redirectURI,
    code,
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
        code
      }),
      signal
    })

    const token = (await tokenResponse.json().catch(() => ({}))) as {
      id_token?: string
    }
    if (!token.id_token) throw new AuthApiError("unauthenticated", 401)

    // Decoded rather than verified on purpose: this token came back over TLS
    // directly from Google's token endpoint in response to our own client secret,
    // so the channel already establishes provenance. Verifying the signature here
    // would mean fetching and caching Google's JWKS to re-prove what the transport
    // just proved. (A token received any other way must always be verified.)
    const claims = decodeJwt(token.id_token) as GoogleIdTokenClaims
    if (!claims.sub) throw new AuthApiError("unauthenticated", 401)

    // Same stakes as GitHub: an unverified address is an account takeover waiting
    // to happen, so it is dropped rather than trusted.
    const email = claims.email_verified === true ? claims.email : undefined

    return {
      providerAccountId: claims.sub,
      ...(email ? { email: email.toLowerCase() } : {}),
      ...(claims.name ? { name: claims.name } : {}),
      ...(claims.picture ? { imageURL: claims.picture } : {})
    }
  }
}
