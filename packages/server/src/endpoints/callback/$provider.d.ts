/** Input for finishing an OAuth flow. */
export interface CallbackProviderInput {
    provider: string;
    code: string | null;
    state: string | null;
    /** Set when the provider itself reported a failure, e.g. the user cancelled. */
    providerError: string | null;
    headers: Headers;
    requestURL: string;
}
/**
 * Finishes an OAuth flow, for both sign-in and linking.
 *
 * One callback serves both because the provider only ever gets one redirect URI.
 * The `intent` recorded in the state cookie decides what happens here, which is
 * what keeps "sign in with GitHub" from ever silently linking GitHub to whoever
 * is currently signed in.
 */
export declare const callbackProvider: import("../../http/define-endpoint.ts").EndpointDefinition<CallbackProviderInput, undefined>;
//# sourceMappingURL=$provider.d.ts.map