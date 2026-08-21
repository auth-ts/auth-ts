import type { CorsOptions } from "../core/auth-server-options.ts";
/**
 * Adds CORS headers when a cross-origin client is configured.
 *
 * The origin is echoed explicitly and never `*`: these responses carry
 * credentials, and browsers refuse the wildcard together with
 * `Allow-Credentials` — correctly, since it would let any site read them.
 */
export declare function applyCorsHeaders(headers: Headers, cors: CorsOptions | undefined): Headers;
/**
 * Answers a preflight request.
 *
 * Needed because the client sends JSON bodies and `PATCH`/`DELETE`, none of
 * which are "simple" requests — without this they fail before the real request
 * is ever made.
 */
export declare function preflightResponse(cors: CorsOptions | undefined): Response | null;
//# sourceMappingURL=apply-cors.d.ts.map