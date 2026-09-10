import type { AuthSession } from "../core/auth-database"
import type { AuthInternals } from "../core/auth-internals"
import { sha256Hex } from "../lib/hash"
import { selectOne } from "../lib/select-one"
import { readRefreshCookies } from "./session-cookies"

/** One refresh cookie this browser presented, and the session its token found. */
export interface PresentedSession {
  /** The cookie's name. A claim: only `session.userId` settles it. */
  userId: string
  tokenHash: string
  session: AuthSession | null
}

/**
 * Every refresh cookie the request carries, resolved to its session row.
 *
 * `live` drops rows past their expiry. `read: false` skips the store and
 * reports `session: null`, for a caller that only needs the hashes.
 */
export function presentedSessions(
  internals: AuthInternals,
  headers: Headers,
  { live = true, read = true }: { live?: boolean; read?: boolean } = {}
): Promise<PresentedSession[]> {
  return Promise.all(
    [...readRefreshCookies(internals, headers)].map(
      async ([userId, rawToken]) => {
        const tokenHash = await sha256Hex(rawToken)
        const session = read
          ? await selectOne(internals, "sessions", {
              tokenHash: { eq: tokenHash },
              ...(live ? { expiresAt: { gt: new Date() } } : {})
            })
          : null

        return { userId, tokenHash, session }
      }
    )
  )
}
