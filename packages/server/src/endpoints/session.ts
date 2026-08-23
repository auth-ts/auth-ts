import type { AuthSession } from "../core/auth-db"
import { unauthenticated } from "../http/auth-api-error"
import { defineEndpoint } from "../http/define-endpoint"
import { selectOne } from "../lib/select-one"
import type { CallerInput } from "../session/authenticate"
import { authenticate } from "../session/authenticate"

/** The caller's own session — the row, less the hash. */
export type CurrentSession = Omit<AuthSession, "tokenHash">

/**
 * The session this browser is on.
 *
 * Authenticated from the access token like everything else, so it is one read
 * of `sessions` and no session write — the write happens on the token refresh,
 * which is the request that had to look at the cookie anyway.
 *
 * Its `id` is how a device list tells which entry is this device.
 */
export const getSession = defineEndpoint({
  method: "GET",
  path: "/session",
  parse: ({ request }): CallerInput => ({ headers: request.headers }),
  run: async (internals, input: CallerInput) => {
    const caller = await authenticate(internals, input)
    // Already in hand whenever the cookie did the work, which is the refresh
    // path — so refreshing a token costs the touch and the user read, and no
    // second look at a row just written.
    const found =
      caller.session ??
      (caller.tokenHash
        ? await selectOne(internals, "sessions", {
            tokenHash: caller.tokenHash
          })
        : null)
    if (!found) throw unauthenticated()

    const { tokenHash, ...session } = found

    return { data: session satisfies CurrentSession, headers: caller.headers }
  }
})
