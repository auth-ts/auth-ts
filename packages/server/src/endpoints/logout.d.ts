/**
 * How far a sign-out reaches.
 *
 * `"local"` is the default because the alternative is a well-known footgun:
 * signing out on a shared computer should not kill the session on your phone.
 */
export type LogoutScope = "local" | "others" | "global";
/** Body accepted by `POST /logout`. */
export interface LogoutInput {
    scope?: LogoutScope;
    headers?: Headers;
    requestURL?: string;
}
/**
 * Ends sessions.
 *
 * Worth stating wherever the button is built: revoked devices keep working until
 * their current access token expires, so "signed out everywhere" means within
 * `jwt.ttl`. That is the same bound the data plane has, by design.
 */
export declare const logout: import("../http/define-endpoint.ts").EndpointDefinition<LogoutInput, {
    switchedTo: import("../index.ts").AuthUser;
    accessToken: string;
} | undefined>;
//# sourceMappingURL=logout.d.ts.map