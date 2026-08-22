import type { ProviderCredentials } from "../../core/auth-server-options.ts"

/** The identity a provider vouches for, after its verification rules are applied. */
export interface ProviderIdentity {
  /**
   * The provider's stable id for this account — GitHub's numeric id, Google's `sub`.
   *
   * Stable is the operative word: people change their email at the provider, and
   * matching on email would quietly create a second account for the same person.
   */
  providerAccountId: string
  /**
   * A **verified** email address, or `undefined` if the provider has none.
   *
   * Providers return unverified addresses too. Accepting one is a full account
   * takeover: sign up at the provider with someone else's email, never confirm
   * it, and inherit their account here. Each provider's rule for "verified" is
   * enforced in its own module.
   */
  email?: string
  name?: string
  imageURL?: string
}

/** What building an authorize URL needs. */
export interface AuthorizeURLInput {
  credentials: ProviderCredentials
  redirectURI: string
  state: string
  /**
   * The PKCE S256 challenge. Every provider sends it as `code_challenge` with
   * `code_challenge_method=S256`; the verifier it was derived from arrives in
   * {@link ExchangeCodeInput.codeVerifier} and never touches the browser.
   */
  codeChallenge: string
  /**
   * The OIDC nonce. Providers that return an ID token send it as `nonce` and
   * refuse a token that does not echo it; plain OAuth providers ignore it.
   */
  nonce: string
}

/** What exchanging an authorization code needs. */
export interface ExchangeCodeInput {
  credentials: ProviderCredentials
  redirectURI: string
  code: string
  /** The PKCE verifier, sent as `code_verifier` to the token endpoint. */
  codeVerifier: string
  /** The nonce the authorize request carried, for providers that verify an ID token. */
  nonce: string
  /**
   * Deadline for the whole exchange, owned by the callback endpoint. Every
   * network call a provider makes must pass it to `fetch`, so a stalled provider
   * cannot hold the callback request open indefinitely.
   */
  signal: AbortSignal
}

/**
 * One OAuth provider.
 *
 * Deliberately small: the endpoints are generic over `:provider`, so adding a
 * provider is a new module plus a registry entry — never a new route, and never
 * a change to the callback flow.
 */
export interface OAuthProvider {
  /** Provider id as it appears in the URL, e.g. `"github"`. */
  id: string
  /** Where to send the browser to begin the flow. */
  authorizeURL(input: AuthorizeURLInput): string
  /** Trades the authorization code for whatever the identity lookup needs. */
  exchangeCode(input: ExchangeCodeInput): Promise<ProviderIdentity>
}
