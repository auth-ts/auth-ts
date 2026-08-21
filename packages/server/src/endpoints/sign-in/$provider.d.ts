/** Input for starting an OAuth sign-in. */
export interface SignInProviderInput {
    provider: string;
    /** Same-origin path to return to; anything else falls back to `/`. */
    redirect?: string;
    locale?: string;
    additionalFields?: Record<string, unknown>;
    headers?: Headers;
    requestURL?: string;
}
/**
 * Starts an OAuth sign-in.
 *
 * The route is generic over the provider so that adding one stays configuration
 * rather than a new endpoint.
 *
 * Signing in while already signed in never links accounts — it either appends
 * another account or replaces the current one, depending on `multiAccount`.
 * Linking is what `/connect` is for, and the two are kept apart by the `intent`
 * recorded in the state cookie. Anything else would mean a stray sign-in silently
 * attaching a provider to whoever happened to be logged in.
 */
export declare const signInProvider: import("../../http/define-endpoint.ts").EndpointDefinition<SignInProviderInput, undefined>;
//# sourceMappingURL=$provider.d.ts.map