import type { IdentifierBody } from "../magic-code/resolve-code-identifier.ts";
/** Body accepted by `POST /send-code`: exactly one identifier. */
export interface SendCodeInput extends IdentifierBody {
    /** Pre-resolved locale and headers, filled in from the request when over HTTP. */
    locale?: string;
    headers?: Headers;
}
/**
 * Sends a sign-in code.
 *
 * Always answers 200, even for an address that has never been seen. The user is
 * created when the code is verified, not here, so there is genuinely nothing to
 * enumerate — a different status for unknown addresses would turn this endpoint
 * into a "does this person have an account" oracle.
 */
export declare const sendCode: import("../http/define-endpoint.ts").EndpointDefinition<SendCodeInput, {
    sent: boolean;
}>;
//# sourceMappingURL=send-code.d.ts.map