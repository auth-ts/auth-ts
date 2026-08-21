/** Body accepted by `POST /accounts/switch`. */
export interface SwitchAccountInput {
    userId: string;
    headers?: Headers;
    requestURL?: string;
}
/**
 * Makes one of this browser's parked accounts the active one.
 *
 * Nothing is re-authenticated, and nothing needs to be: possession of the parked
 * refresh token is exactly the same proof as possession of the active one. All
 * that changes is which cookie holds which token, so the tokens never become
 * readable by JavaScript at any point in the swap.
 */
export declare const switchAccount: import("../../http/define-endpoint.ts").EndpointDefinition<SwitchAccountInput, {
    accessToken: string;
    user: import("../../index.ts").AuthUser;
}>;
//# sourceMappingURL=switch.d.ts.map