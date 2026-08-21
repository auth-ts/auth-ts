import type { HeadersInput } from "../session/resolve-session.ts"
/** What `POST /token` and `authServer.getToken` return. */
export interface AuthTokenResult {
  accessToken: string
  user: import("../core/auth-db.ts").AuthUser
  session: import("../core/auth-db.ts").AuthSession
}
/**
 * Exchanges the refresh cookie for a fresh access token.
 *
 * The refresh token is **not** rotated. The cookie is `HttpOnly`, path-scoped, and
 * never crosses an origin, so rotation would buy very little; what it would
 * reliably buy is a race between concurrent tabs, where the second tab presents
 * a token the first has already spent. Consumers who store the refresh token
 * outside an `HttpOnly` cookie do need rotation and reuse detection — which is
 * exactly why this library does not support that mode.
 *
 * @throws {AuthApiError} `unauthenticated` when there is no live session.
 */
export declare const getToken: import("../http/define-endpoint.ts").EndpointDefinition<
  HeadersInput,
  {
    accessToken: string
    user: import("../index.ts").AuthUser
    session: import("../index.ts").AuthSession
  }
>
//# sourceMappingURL=token.d.ts.map
