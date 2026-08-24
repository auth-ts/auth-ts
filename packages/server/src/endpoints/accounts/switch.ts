import { notFound } from "../../http/auth-api-error"
import { defineEndpoint } from "../../http/define-endpoint"
import { selectOne } from "../../lib/select-one"
import {
  serializeCookie,
  shouldUseSecureCookies
} from "../../lib/serialize-cookie"
import type { EndpointDocs } from "../../openapi/endpoint-docs"
import {
  demoteActive,
  parkedTokens,
  promoteAccount,
  pruneDeadAccounts,
  readAccountsCookie,
  serializeAccounts
} from "../../session/accounts-cookie"
import type { CallerInput } from "../../session/authenticate"
import { authenticate } from "../../session/authenticate"
import { mintAccessToken } from "../../session/issue-session"
import { readRefreshToken } from "../../session/resolve-session"
import { refreshCookies } from "../../session/session-cookies"

/** Body accepted by `POST /accounts/switch`. */
export interface SwitchAccountInput extends CallerInput {
  userId: string
  requestURL?: string
}

/** How `POST /accounts/switch` appears in the OpenAPI document. */
export const switchAccountDocs: EndpointDocs<SwitchAccountInput> = {
  description:
    "Nothing is re-authenticated, and nothing needs to be: holding the parked refresh token is the same proof as holding the active one. Only which cookie holds which token changes, so neither becomes readable by JavaScript during the swap.",
  tag: "Accounts",
  auth: "bearer",
  requires: "multiAccount",
  body: {
    type: "object",
    properties: {
      userId: {
        type: "string",
        description: "The account to make active, from `GET /accounts`."
      }
    },
    required: ["userId"]
  },
  responses: {
    200: {
      description: "Switched. The new active account and its token.",
      setsCookie: "refresh",
      schema: "TokenResult"
    },
    401: "Unauthenticated",
    404: "NotFound"
  }
}

/**
 * Makes one of this browser's parked accounts the active one.
 *
 * Nothing is re-authenticated, and nothing needs to be: possession of the parked
 * refresh token is exactly the same proof as possession of the active one. All
 * that changes is which cookie holds which token, so the tokens never become
 * readable by JavaScript at any point in the swap.
 */
export const switchAccount = defineEndpoint({
  method: "POST",
  path: "/accounts/switch",
  parse: async ({ request }): Promise<SwitchAccountInput> => {
    const body = (await request.json().catch(() => ({}))) as { userId?: string }

    return {
      userId: body.userId ?? "",
      headers: request.headers,
      requestURL: request.url
    }
  },
  run: async (internals, input: SwitchAccountInput) => {
    const { config } = internals
    if (!config.multiAccount) throw notFound()

    const headers = input.headers ?? new Headers()
    await authenticate(internals, input)

    const parked = await pruneDeadAccounts(
      internals,
      readAccountsCookie(internals, headers)
    )
    const target = parked.find(({ session }) => session.userId === input.userId)
    if (!target) throw notFound()

    const targetUser = await selectOne(internals, "users", { id: input.userId })
    if (!targetUser) throw notFound()

    const currentToken = readRefreshToken(internals, headers)
    const remaining = promoteAccount(parkedTokens(parked), target.token)
    const nextParked = currentToken
      ? await demoteActive(internals, remaining, currentToken)
      : remaining

    const secure = shouldUseSecureCookies(input.requestURL)
    const token = await mintAccessToken(
      internals,
      targetUser,
      target.session.id
    )
    const responseHeaders = new Headers()
    for (const cookie of refreshCookies(internals, {
      rawToken: target.token,
      requestURL: input.requestURL,
      headers
    })) {
      responseHeaders.append("set-cookie", cookie)
    }
    responseHeaders.append(
      "set-cookie",
      serializeCookie({
        name: config.cookie.accountsName,
        value: serializeAccounts(nextParked),
        path: config.cookie.path,
        maxAge: config.session.ttl,
        secure
      })
    )

    return {
      data: { user: targetUser, token },
      headers: responseHeaders
    }
  }
})
