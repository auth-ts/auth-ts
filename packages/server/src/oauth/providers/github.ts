import { AuthApiError } from "../../http/auth-api-error"
import { expiresAt, requestedScopes } from "./grant"
import type {
  AuthorizeURLInput,
  ExchangeCodeInput,
  OAuthProvider,
  ProviderIdentity,
  ProviderTokens,
  RefreshAccessTokenInput
} from "./oauth-provider"
import { isProviderUnavailable, providerRejected } from "./provider-response"

interface GitHubUser {
  id: number
  name?: string | null
  login: string
  avatar_url?: string | null
}

interface GitHubEmail {
  email: string
  primary: boolean
  verified: boolean
}

/**
 * GitHub sign-in.
 *
 * Scope is `read:user user:email` because the profile response does not include
 * a usable email — `/user/emails` is a second call, and the only one that reports
 * verification status.
 *
 * PKCE is sent on every flow; GitHub has honoured it for OAuth apps since July
 * 2025. No `nonce`: GitHub issues no ID token, so there is nothing to echo it in.
 */
export const github: OAuthProvider = {
  id: "github",

  authorizeURL({
    credentials,
    redirectURI,
    state,
    codeChallenge
  }: AuthorizeURLInput) {
    const parameters = new URLSearchParams({
      client_id: credentials.clientId,
      redirect_uri: redirectURI,
      scope: requestedScopes(credentials, ["read:user", "user:email"]),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256"
    })

    return `https://github.com/login/oauth/authorize?${parameters.toString()}`
  },

  async exchangeCode({
    credentials,
    redirectURI,
    code,
    codeVerifier,
    signal
  }: ExchangeCodeInput): Promise<ProviderIdentity> {
    const tokenResponse = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          redirect_uri: redirectURI,
          code,
          code_verifier: codeVerifier
        }),
        signal
      }
    )

    if (!tokenResponse.ok) throw providerRejected(tokenResponse)
    const token = (await tokenResponse.json().catch(() => ({}))) as GitHubTokens
    if (!token.access_token) throw new AuthApiError("unauthenticated", 401)

    const authorization = {
      authorization: `Bearer ${token.access_token}`,
      "user-agent": "auth-ts"
    }

    const profileResponse = await fetch("https://api.github.com/user", {
      headers: authorization,
      signal
    })
    if (!profileResponse.ok) throw providerRejected(profileResponse)
    const profile = (await profileResponse.json()) as GitHubUser

    const emailResponse = await fetch("https://api.github.com/user/emails", {
      headers: authorization,
      signal
    })
    // A 4xx here — typically the scope was not granted — is legitimately "no
    // verified address", and the flow below refuses the sign-in for that reason.
    // GitHub being down or throttling must not masquerade as that refusal.
    if (isProviderUnavailable(emailResponse))
      throw providerRejected(emailResponse)
    const emails = emailResponse.ok
      ? ((await emailResponse.json()) as GitHubEmail[])
      : []

    // Only the primary *and* verified address. GitHub happily returns addresses
    // the user has never confirmed, and trusting one would let an attacker claim
    // somebody else's account by listing their address and never verifying it.
    const verified = emails.find((entry) => entry.primary && entry.verified)

    return {
      providerUserId: String(profile.id),
      // The handle, not the address: `login` is always present, while a primary
      // verified email frequently is not.
      label: profile.login,
      ...(verified ? { email: verified.email.toLowerCase() } : {}),
      ...(profile.name ? { name: profile.name } : { name: profile.login }),
      ...(profile.avatar_url ? { imageURL: profile.avatar_url } : {}),
      tokens: readTokens(token)
    }
  },

  async refreshAccessToken({
    credentials,
    refreshToken,
    signal
  }: RefreshAccessTokenInput): Promise<ProviderTokens> {
    const response = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken
        }),
        signal
      }
    )

    if (!response.ok) throw providerRejected(response)
    const token = (await response.json().catch(() => ({}))) as GitHubTokens

    // GitHub reports a dead grant as a 200 with an `error` body rather than a
    // status, so the refusal has to be read out of the payload.
    if (!token.access_token) {
      throw new AuthApiError("providerReconnectRequired", 403)
    }

    return readTokens(token)
  }
}

/**
 * The token endpoint's response.
 *
 * A classic OAuth App issues a bare, non-expiring `access_token` and nothing
 * else; a GitHub App with expiring tokens issues all five, and rotates the
 * refresh token on every use — which is why a refresh writes back whatever it
 * returns rather than only the access token.
 */
interface GitHubTokens {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  refresh_token_expires_in?: number
  scope?: string
}

function readTokens(token: GitHubTokens): ProviderTokens {
  return {
    ...(token.access_token ? { accessToken: token.access_token } : {}),
    ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
    ...(typeof token.expires_in === "number"
      ? { accessTokenExpiresAt: expiresAt(token.expires_in) }
      : {}),
    ...(typeof token.refresh_token_expires_in === "number"
      ? { refreshTokenExpiresAt: expiresAt(token.refresh_token_expires_in) }
      : {}),
    ...(token.scope ? { scope: token.scope } : {})
  }
}
