import type { IssueMode } from "../../session/issue-session.ts";
/** Body accepted by `POST /sign-in/guest`. */
export interface SignInGuestInput {
    additionalFields?: Record<string, unknown>;
    mode?: IssueMode;
    headers?: Headers;
    requestURL?: string;
}
/**
 * Signs in an anonymous user.
 *
 * A guest is a full user — real id, real session, real rows under row-level
 * security — which is what makes conversion later a rename rather than a
 * migration.
 *
 * Disabled unless `guest: true`, and rate limited per IP even then, because
 * anonymous account creation is an endpoint that writes a row for anyone who
 * asks. Worth telling users: a guest who loses the cookie loses the account,
 * until they connect a provider or verify an identifier.
 */
export declare const signInGuest: import("../../http/define-endpoint.ts").EndpointDefinition<SignInGuestInput, {
    accessToken: string;
    user: import("../../index.ts").AuthUser;
    refreshToken?: string | undefined;
}>;
//# sourceMappingURL=guest.d.ts.map