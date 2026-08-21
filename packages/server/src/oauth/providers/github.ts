import { AuthApiError } from "../../http/auth-api-error.ts"
import type {
  AuthorizeURLInput,
  ExchangeCodeInput,
  OAuthProvider,
  ProviderIdentity
} from "./oauth-provider.ts"

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
 */
export const github: OAuthProvider = {
  id: "github",

  authorizeURL({ credentials, redirectURI, state }: AuthorizeURLInput) {
    const parameters = new URLSearchParams({
      client_id: credentials.clientId,
      redirect_uri: redirectURI,
      scope: "read:user user:email",
      state
    })

    return `https://github.com/login/oauth/authorize?${parameters.toString()}`
  },

  async exchangeCode({
    credentials,
    redirectURI,
    code,
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
          code
        }),
        signal
      }
    )

    const token = (await tokenResponse.json().catch(() => ({}))) as {
      access_token?: string
    }
    if (!token.access_token) throw new AuthApiError("unauthenticated", 401)

    const authorization = {
      authorization: `Bearer ${token.access_token}`,
      "user-agent": "auth-ts"
    }

    const profileResponse = await fetch("https://api.github.com/user", {
      headers: authorization,
      signal
    })
    if (!profileResponse.ok) throw new AuthApiError("unauthenticated", 401)
    const profile = (await profileResponse.json()) as GitHubUser

    const emailResponse = await fetch("https://api.github.com/user/emails", {
      headers: authorization,
      signal
    })
    const emails = emailResponse.ok
      ? ((await emailResponse.json()) as GitHubEmail[])
      : []

    // Only the primary *and* verified address. GitHub happily returns addresses
    // the user has never confirmed, and trusting one would let an attacker claim
    // somebody else's account by listing their address and never verifying it.
    const verified = emails.find((entry) => entry.primary && entry.verified)

    return {
      providerAccountId: String(profile.id),
      ...(verified ? { email: verified.email.toLowerCase() } : {}),
      ...(profile.name ? { name: profile.name } : { name: profile.login }),
      ...(profile.avatar_url ? { imageURL: profile.avatar_url } : {})
    }
  }
}
