import type { AuthUser } from "../core/auth-db.ts"
import type { AuthServerInternals } from "../core/auth-server-internals.ts"
/**
 * Where the refresh token goes.
 *
 * `"cookie"` is the default and the only mode browsers should use. `"token"`
 * returns the refresh token in the body for native and CLI clients that have no
 * cookie jar — with the consequence, documented loudly, that the client is then
 * responsible for storing a long-lived credential safely.
 */
export type IssueMode = "cookie" | "token"
/** What issuing a session produced. */
export interface IssueResult {
  accessToken: string
  user: AuthUser
  /** Present only in `"token"` mode. */
  refreshToken?: string
  /** `Set-Cookie` headers the caller must send. */
  headers: Headers
}
/** Everything issuing needs from the request. */
export interface IssueSessionInput {
  user: AuthUser
  headers: Headers
  requestURL: string
  mode?: IssueMode
}
/**
 * Creates a session and mints an access token — the single path every sign-in
 * method ends at.
 *
 * Magic code, guest, OAuth, and account switching all converge here, so cookie
 * attributes, session stamping, and multi-account behaviour are defined once
 * rather than re-implemented per method with slightly different mistakes.
 *
 * The database is given only `sha256(token)`. Possession of the raw token proves
 * identity; the stored hash proves nothing on its own, so a leaked table cannot
 * be replayed and a leaked token cannot be located in the table.
 */
export declare function issueSession(
  internals: AuthServerInternals,
  { user, headers, requestURL, mode }: IssueSessionInput
): Promise<IssueResult>
/**
 * Signs an access token for a user.
 *
 * `type` rides along because row-level security reads it; `role` stays whatever
 * the configuration says, because it maps to a real Postgres role. `primaryUserId`
 * is deliberately never included — it describes a pending data migration, not who
 * is signed in.
 */
export declare function mintAccessToken(
  internals: AuthServerInternals,
  user: AuthUser
): Promise<string>
/**
 * Extends a session's expiry on refresh, when sliding is enabled.
 *
 * `createdAt` is passed through unchanged: it records when identity was proven,
 * which is what account deletion checks. Sliding it would let a browser left open
 * for a month look freshly authenticated.
 */
export declare function slideSession(
  internals: AuthServerInternals,
  session: {
    id: string
    userId: string
    tokenHash: string
    createdAt: Date
  },
  headers: Headers
): Promise<void>
//# sourceMappingURL=issue-session.d.ts.map
