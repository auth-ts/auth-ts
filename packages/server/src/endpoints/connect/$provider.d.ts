import type { SignInProviderInput } from "../sign-in/$provider.ts";
/** Input for starting a provider link. */
export interface ConnectProviderInput extends SignInProviderInput {
}
/**
 * Starts linking a provider to the **current** user.
 *
 * Requires a session up front, and records that user's id in the state so the
 * callback can insist the same person is still signed in when they come back.
 */
export declare const connectProvider: import("../../http/define-endpoint.ts").EndpointDefinition<ConnectProviderInput, undefined>;
//# sourceMappingURL=$provider.d.ts.map