import type { ProviderCredentials } from "../../core/auth-options"
import type { ProviderTokens } from "./oauth-provider"
import { providerRejected } from "./provider-response"

/**
 * The scopes to ask for: what sign-in needs, plus whatever the deployment added.
 *
 * Deduplicated, because a configured scope that repeats a baseline one is the
 * obvious mistake and some providers echo the duplicate straight back into the
 * granted `scope`.
 */
export function requestedScopes(
  credentials: ProviderCredentials,
  baseline: string[]
) {
  return [...new Set([...baseline, ...(credentials.scopes ?? [])])].join(" ")
}

/** Turns a provider's `expires_in` seconds into the instant it names. */
export function expiresAt(seconds: number) {
  return new Date(Date.now() + seconds * 1000)
}

/** A token endpoint's body. Only GitHub sends `refresh_token_expires_in`. */
export interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  refresh_token_expires_in?: number
  scope?: string
}

/** Non-2xx is the provider's verdict; an unparseable 2xx reads as empty. */
export async function readTokenResponse<
  T extends TokenResponse = TokenResponse
>(response: Response): Promise<T> {
  if (!response.ok) throw providerRejected(response)
  return (await response.json().catch(() => ({}))) as T
}

/** Each field is kept only when the provider sent it, so a refresh erases nothing. */
export function readTokens(token: TokenResponse): ProviderTokens {
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
