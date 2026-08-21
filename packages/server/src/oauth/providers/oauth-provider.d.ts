import type { ProviderCredentials } from "../../core/auth-server-options.ts";
/** The identity a provider vouches for, after its verification rules are applied. */
export interface ProviderIdentity {
    /**
     * The provider's stable id for this account — GitHub's numeric id, Google's `sub`.
     *
     * Stable is the operative word: people change their email at the provider, and
     * matching on email would quietly create a second account for the same person.
     */
    providerAccountId: string;
    /**
     * A **verified** email address, or `undefined` if the provider has none.
     *
     * Providers return unverified addresses too. Accepting one is a full account
     * takeover: sign up at the provider with someone else's email, never confirm
     * it, and inherit their account here. Each provider's rule for "verified" is
     * enforced in its own module.
     */
    email?: string;
    name?: string;
    imageURL?: string;
}
/** What building an authorize URL needs. */
export interface AuthorizeURLInput {
    credentials: ProviderCredentials;
    redirectURI: string;
    state: string;
}
/** What exchanging an authorization code needs. */
export interface ExchangeCodeInput {
    credentials: ProviderCredentials;
    redirectURI: string;
    code: string;
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
    id: string;
    /** Where to send the browser to begin the flow. */
    authorizeURL(input: AuthorizeURLInput): string;
    /** Trades the authorization code for whatever the identity lookup needs. */
    exchangeCode(input: ExchangeCodeInput): Promise<ProviderIdentity>;
}
//# sourceMappingURL=oauth-provider.d.ts.map