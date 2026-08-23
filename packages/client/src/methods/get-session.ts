import type { CurrentSession } from "@auth-ts/server"
import type { AuthClientInternals } from "../core/auth-client-internals"

/**
 * The session this browser is on — the row, confirmed live.
 *
 * One statement server-side, no user lookup, no token minted. Its `createdAt`
 * is when identity was last proven, which is what a freshness check reads.
 * For merely *which* session this is, the token already says: `sid` from
 * `decodeToken` costs no request.
 */
export function createGetSession(internals: AuthClientInternals) {
  return async function getSession(): Promise<CurrentSession> {
    return internals.fetchJson<CurrentSession>({
      method: "GET",
      path: "/session",
      authenticated: true
    })
  }
}
