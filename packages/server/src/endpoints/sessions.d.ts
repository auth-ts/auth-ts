import type { HeadersInput } from "../session/resolve-session.ts";
/** One entry in the "your devices" list. */
export interface SessionInfo {
    /** The browser-safe address of this session. */
    id: string;
    createdAt: Date;
    expiresAt: Date;
    userAgent?: string | null;
    ipAddress?: string | null;
    /** Whether this is the session making the request. */
    current: boolean;
}
/**
 * Lists the signed-in user's sessions.
 *
 * `tokenHash` never crosses to the browser — `id` is the only address a client
 * ever sees, and it is the only thing revocation needs.
 *
 * This has to live in core rather than in application code: the refresh cookie is
 * path-scoped to the auth mount, so an application route cannot see it and
 * therefore cannot tell which session is the current one.
 */
export declare const listSessions: import("../http/define-endpoint.ts").EndpointDefinition<HeadersInput, {
    sessions: SessionInfo[];
}>;
//# sourceMappingURL=sessions.d.ts.map