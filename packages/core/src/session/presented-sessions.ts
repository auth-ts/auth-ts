import type { AuthSession } from "../core/auth-database"
import type { AuthInternals } from "../core/auth-internals"
import { readRefreshCookies } from "./session-cookies"
import type { SessionCredential } from "./session-token"
import { findSession, parseSessionToken } from "./session-token"

/** One refresh cookie this browser presented, and the session its token found. */
export interface PresentedSession {
  /** The cookie's name. A claim: only `session.userId` settles it. */
  userId: string
  /** `null` for a cookie that is not `id.secret` — nothing to read or revoke. */
  credential: SessionCredential | null
  session: AuthSession | null
}

/**
 * Every refresh cookie the request carries, resolved to its session row.
 *
 * `live` drops rows past their expiry. `read: false` skips the store and
 * reports `session: null`, for a caller that only needs the credentials.
 */
export function presentedSessions(
  internals: AuthInternals,
  headers: Headers,
  { live = true, read = true }: { live?: boolean; read?: boolean } = {}
): Promise<PresentedSession[]> {
  return Promise.all(
    [...readRefreshCookies(internals, headers)].map(
      async ([userId, rawToken]) => {
        const credential = await parseSessionToken(rawToken)
        const session =
          read && credential
            ? await findSession(internals, credential, { live })
            : null

        return { userId, credential, session }
      }
    )
  )
}
