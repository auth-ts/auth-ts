import type { IdentifierBody } from "../magic-code/resolve-code-identifier.ts";
import type { IssueMode } from "../session/issue-session.ts";
/** Body accepted by `POST /verify-code`. */
export interface VerifyCodeInput extends IdentifierBody {
    code: string;
    /** `"token"` returns the refresh token in the body, for native clients. */
    mode?: IssueMode;
    /** Values for fields declared in `user.additionalFields`, applied on creation only. */
    additionalFields?: Record<string, unknown>;
    headers?: Headers;
    requestURL?: string;
}
/**
 * Verifies a code and starts a session.
 *
 * Creating the user happens here rather than at send time, which is what makes
 * `send-code` safe to answer identically for everyone.
 *
 * If the caller is currently a guest, this completes their conversion — either
 * upgrading the guest row in place or attaching it to the account that already
 * owns the identifier.
 */
export declare const verifyCode: import("../http/define-endpoint.ts").EndpointDefinition<VerifyCodeInput, {
    accessToken: string;
    user: import("../index.ts").AuthUser;
    refreshToken?: string | undefined;
}>;
//# sourceMappingURL=verify-code.d.ts.map