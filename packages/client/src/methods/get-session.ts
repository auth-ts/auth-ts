import type { CurrentSession } from "@auth-ts/server"
import type { AuthClientInternals } from "../core/auth-client-internals"

/**
 * The session this browser is on, and the act of keeping it alive.
 *
 * The cheap read: one statement server-side, no user lookup, no token minted.
 * Its `id` is how a device list tells which entry is this device — that
 * comparison belongs here rather than as a flag the server adds to every row.
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
