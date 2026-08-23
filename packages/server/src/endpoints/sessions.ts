import { defineEndpoint } from "../http/define-endpoint"
import type { CallerInput } from "../session/authenticate"
import { authenticate } from "../session/authenticate"
import { listUserSessions } from "../session/list-user-sessions"

/**
 * One entry in the "your devices" list.
 *
 * The dates are `Date` on both sides of the wire: JSON carries them as ISO
 * strings, and `@auth-ts/client` revives them, so application code never has to
 * know they were ever serialized. Anyone calling `GET /sessions` without the
 * client receives the ISO strings.
 */
export interface SessionInfo {
  /** The browser-safe address of this session. */
  id: string
  createdAt: Date
  expiresAt: Date
  userAgent?: string | null
  ipAddress?: string | null
  /** Whether this is the session making the request. */
  current: boolean
}

/**
 * Lists the signed-in user's sessions.
 *
 * `tokenHash` never crosses to the browser — `id` is the only address a client
 * ever sees, and it is the only thing revocation needs.
 *
 * This lives in core rather than in application code because marking the
 * current session means hashing the raw refresh token and comparing, and the
 * raw token is something application code never handles — and, once
 * `cookie.path` is narrowed to the auth mount, cannot even see.
 *
 * Newest first, capped at {@link SESSION_PAGE_SIZE}. A person with more live
 * sessions than that has a device list nobody scrolls and a problem this screen
 * is not going to solve.
 */
export const listSessions = defineEndpoint({
  method: "GET",
  path: "/sessions",
  parse: ({ request }): CallerInput => ({ headers: request.headers }),
  run: async (internals, input: CallerInput) => {
    const caller = await authenticate(internals, input)

    const sessions = await listUserSessions(internals, caller.userId)
    const data: SessionInfo[] = sessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      userAgent: session.userAgent ?? null,
      ipAddress: session.ipAddress ?? null,
      current: session.tokenHash === caller.tokenHash
    }))

    return { data: { sessions: data } }
  }
})
