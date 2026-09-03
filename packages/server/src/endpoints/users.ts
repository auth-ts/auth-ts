import type { AuthUser } from "../core/auth-db"
import { notFound } from "../http/auth-api-error"
import { defineEndpoint } from "../http/define-endpoint"
import { sha256Hex } from "../lib/hash"
import { selectOne } from "../lib/select-one"
import type { EndpointDocs } from "../openapi/endpoint-docs"
import type { CallerInput } from "../session/authenticate"
import { authenticate } from "../session/authenticate"
import { readRefreshCookies } from "../session/session-cookies"

/** How `GET /users` appears in the OpenAPI document. */
export const listUsersDocs: EndpointDocs<never> = {
  description:
    "Read from this browser's refresh cookies, so parked accounts are listed too, not only the active one.",
  tag: "Users",
  auth: "bearer",
  requires: "multiUser",
  responses: {
    200: {
      description: "Every user signed in to this browser.",
      schema: { type: "array", items: "User" }
    },
    401: "Unauthenticated"
  }
}

/**
 * List the signed in users.
 *
 * The switcher. One refresh cookie per user means this is a read of what the
 * browser presented and nothing else — no parked list to prune, and no
 * `Set-Cookie` on the way out.
 *
 * A cookie whose session has died is skipped rather than returned, so a revoked
 * device stops appearing here on the next request rather than lingering until
 * someone clicks it. The cookie itself is left alone: the session is already
 * gone, so the worst it can do is be skipped again.
 *
 * Which of them is active is the caller's comparison — `GET /token` already
 * says who that is, so a flag here would be the same answer written twice.
 */
export const listUsers = defineEndpoint({
  method: "GET",
  path: "/users",
  parse: ({ request }): CallerInput => ({ headers: request.headers }),
  run: async (internals, input: CallerInput) => {
    const { config } = internals
    if (!config.multiUser) throw notFound()

    const headers = input.headers ?? new Headers()
    await authenticate(internals, input)

    // Concurrently: this is one round trip per signed-in user, bounded by how
    // many cookies a browser will hold for one host.
    const presented = [...readRefreshCookies(internals, headers)]
    const users = await Promise.all(
      presented.map(async ([userId, rawToken]) => {
        const session = await selectOne(internals, "sessions", {
          tokenHash: await sha256Hex(rawToken),
          expiresAt: { gt: new Date() }
        })
        // The row is read by the session's own owner, never by the name on the
        // cookie: a name is written by whoever sent it, so trusting one would
        // hand back any user's row to anybody holding a token of their own.
        if (!session || session.userId !== userId) return null

        return selectOne(internals, "users", { id: session.userId })
      })
    )

    return { data: users.filter((user): user is AuthUser => user !== null) }
  }
})
