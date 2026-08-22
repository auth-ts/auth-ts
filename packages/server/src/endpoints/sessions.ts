import { unauthenticated } from "../http/auth-api-error"
import { defineEndpoint } from "../http/define-endpoint"
import type { HeadersInput } from "../session/resolve-session"
import { resolveSession } from "../session/resolve-session"

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
 * This has to live in core rather than in application code: the refresh cookie is
 * path-scoped to the auth mount, so an application route cannot see it and
 * therefore cannot tell which session is the current one.
 */
export const listSessions = defineEndpoint({
  method: "GET",
  path: "/sessions",
  parse: ({ request }): HeadersInput => ({ headers: request.headers }),
  run: async (internals, input: HeadersInput) => {
    const resolved = await resolveSession(internals, input.headers)
    if (!resolved) throw unauthenticated()

    const sessions = await internals.db.listSessions({
      userId: resolved.user.id
    })
    const data: SessionInfo[] = sessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      userAgent: session.userAgent ?? null,
      ipAddress: session.ipAddress ?? null,
      current: session.tokenHash === resolved.tokenHash
    }))

    return { data: { sessions: data } }
  }
})
