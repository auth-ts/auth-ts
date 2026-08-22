import { notFound, unauthenticated } from "../../http/auth-api-error.ts"
import { defineEndpoint } from "../../http/define-endpoint.ts"
import {
  serializeCookie,
  shouldUseSecureCookies
} from "../../lib/serialize-cookie.ts"
import {
  demoteActive,
  parkedTokens,
  promoteAccount,
  pruneDeadAccounts,
  readAccountsCookie,
  serializeAccounts
} from "../../session/accounts-cookie.ts"
import { mintAccessToken } from "../../session/issue-session.ts"
import {
  readRefreshToken,
  resolveSession
} from "../../session/resolve-session.ts"

/** Body accepted by `POST /accounts/switch`. */
export interface SwitchAccountInput {
  userId: string
  headers?: Headers
  requestURL?: string
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
    const active = await resolveSession(internals, headers)
    if (!active) throw unauthenticated()

    const parked = await pruneDeadAccounts(
      internals,
      readAccountsCookie(internals, headers)
    )
    const target = parked.find(({ session }) => session.userId === input.userId)
    if (!target) throw notFound()

    const targetUser = await internals.db.getUser({ id: input.userId })
    if (!targetUser) throw notFound()

    const currentToken = readRefreshToken(internals, headers)
    const remaining = promoteAccount(parkedTokens(parked), target.token)
    const nextParked = currentToken
      ? await demoteActive(internals, remaining, currentToken)
      : remaining

    const secure = shouldUseSecureCookies(
      input.requestURL ?? "https://localhost"
    )
    const responseHeaders = new Headers()
    responseHeaders.append(
      "set-cookie",
      serializeCookie({
        name: config.cookie.name,
        value: target.token,
        path: config.cookie.path,
        maxAge: config.session.ttl,
        secure
      })
    )
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
      data: {
        accessToken: await mintAccessToken(internals, targetUser),
        user: targetUser
      },
      headers: responseHeaders
    }
  }
})
