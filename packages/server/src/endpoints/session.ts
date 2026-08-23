import type { AuthSession } from "../core/auth-db"
import { unauthenticated } from "../http/auth-api-error"
import { defineEndpoint } from "../http/define-endpoint"
import type { HeadersInput } from "../session/resolve-session"
import { resolveSessionRow } from "../session/resolve-session"

/** The caller's own session — the row, less the hash. */
export type CurrentSession = Omit<AuthSession, "tokenHash">

/**
 * Confirms the session is live and keeps it that way.
 *
 * The cheap call: one row read and one write, with no user lookup, so a client
 * can make it on mount and on focus without paying for a join it is going to
 * throw away. Expiry slides exactly as a token refresh slides it — pushed out,
 * with `updatedAt` and the device stamp rewritten — so the columns say when the
 * session was last used rather than when it was last written to. Turning
 * `session.sliding` off turns the slide off with it.
 */
export const getSession = defineEndpoint({
  method: "GET",
  path: "/session",
  parse: ({ request }): HeadersInput => ({ headers: request.headers }),
  run: async (internals, input: HeadersInput) => {
    const resolved = await resolveSessionRow(internals, input.headers)
    if (!resolved) throw unauthenticated()

    // The hash is the credential itself, and the only column that cannot cross.
    const { tokenHash, ...session } = resolved.session

    return { data: session satisfies CurrentSession }
  }
})
