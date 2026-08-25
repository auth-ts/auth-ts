import { notFound } from "../../http/auth-api-error"
import { defineEndpoint } from "../../http/define-endpoint"
import { selectOne } from "../../lib/select-one"
import type { EndpointDocs } from "../../openapi/endpoint-docs"
import type { CallerInput } from "../../session/authenticate"
import { authenticate } from "../../session/authenticate"
import { mintAccessToken } from "../../session/issue-session"
import {
  readRefreshToken,
  resolveSessionRow
} from "../../session/resolve-session"
import { refreshCookies } from "../../session/session-cookies"

/** Body accepted by `POST /users/switch`. */
export interface SwitchUserInput extends CallerInput {
  userId: string
  requestURL?: string
}

/** How `POST /users/switch` appears in the OpenAPI document. */
export const switchUserDocs: EndpointDocs<SwitchUserInput> = {
  tag: "Users",
  auth: "bearer",
  requires: "multiUser",
  body: {
    type: "object",
    properties: {
      userId: {
        type: "string",
        description: "The user to make active, from `GET /users`."
      }
    },
    required: ["userId"]
  },
  responses: {
    200: {
      description: "Switched. The new active user and its token.",
      setsCookie: "refresh",
      schema: "TokenResult"
    },
    401: "Unauthenticated",
    404: "NotFound"
  }
}

/**
 * Switch to another signed in user.
 *
 * Nothing is re-authenticated, and nothing needs to be: possession of the
 * target's refresh cookie is exactly the same proof as possession of the active
 * one. No token moves between cookies either — each user's already sits in its
 * own — so all that changes is which one the hint names.
 *
 * A POST rather than a GET on purpose. This changes which user subsequent
 * requests resolve to, and `checkOrigin` exempts safe methods from the origin
 * check precisely because they are supposed to have no side effects. As a GET
 * it would be reachable from any other site.
 */
export const switchUser = defineEndpoint({
  method: "POST",
  path: "/users/switch",
  parse: async ({ request }): Promise<SwitchUserInput> => {
    const body = (await request.json().catch(() => ({}))) as { userId?: string }

    return {
      userId: body.userId ?? "",
      headers: request.headers,
      requestURL: request.url
    }
  },
  run: async (internals, input: SwitchUserInput) => {
    const { config } = internals
    if (!config.multiUser) throw notFound()

    const headers = input.headers ?? new Headers()
    await authenticate(internals, input)

    const rawToken = readRefreshToken(internals, headers, input.userId)
    if (!rawToken) throw notFound()

    // Resolved through the same path as any other request, so a cookie whose
    // session has expired or been revoked is a 404 rather than a switch onto
    // nothing — and the switch slides it, which is what makes it the active one.
    const resolved = await resolveSessionRow(internals, headers, input.userId)
    if (!resolved) throw notFound()

    const user = await selectOne(internals, "users", { id: input.userId })
    if (!user) throw notFound()

    const token = await mintAccessToken(internals, user, resolved.session.id)
    const responseHeaders = new Headers()
    // Re-sent unchanged: the value is the same cookie the browser already has,
    // and writing it is how the hint comes to name this user.
    for (const cookie of refreshCookies(internals, {
      rawToken,
      userId: user.id,
      requestURL: input.requestURL,
      headers
    })) {
      responseHeaders.append("set-cookie", cookie)
    }

    return { data: { user, token }, headers: responseHeaders }
  }
})
