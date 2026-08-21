import { unauthenticated } from "../http/auth-api-error.ts"
import { defineEndpoint } from "../http/define-endpoint.ts"
import { sha256Hex } from "../lib/hash.ts"
import {
  clearCookie,
  serializeCookie,
  shouldUseSecureCookies
} from "../lib/serialize-cookie.ts"
import {
  promoteAccount,
  pruneDeadAccounts,
  readAccountsCookie,
  serializeAccounts
} from "../session/accounts-cookie.ts"
import { mintAccessToken } from "../session/issue-session.ts"
import { resolveSession } from "../session/resolve-session.ts"

/**
 * How far a sign-out reaches.
 *
 * `"local"` is the default because the alternative is a well-known footgun:
 * signing out on a shared computer should not kill the session on your phone.
 */
export type LogoutScope = "local" | "others" | "global"

/** Body accepted by `POST /logout`. */
export interface LogoutInput {
  scope?: LogoutScope
  headers?: Headers
  requestURL?: string
}

/**
 * Ends sessions.
 *
 * Worth stating wherever the button is built: revoked devices keep working until
 * their current access token expires, so "signed out everywhere" means within
 * `jwt.ttl`. That is the same bound the data plane has, by design.
 */
export const logout = defineEndpoint({
  method: "POST",
  path: "/logout",
  parse: async ({ request }): Promise<LogoutInput> => {
    const body = (await request.json().catch(() => ({}))) as {
      scope?: LogoutScope
    }

    return { ...body, headers: request.headers, requestURL: request.url }
  },
  run: async (internals, input: LogoutInput) => {
    const headers = input.headers ?? new Headers()
    const requestURL = input.requestURL ?? "https://localhost"
    const resolved = await resolveSession(internals, headers)
    if (!resolved) throw unauthenticated()

    const { options } = internals
    const scope = input.scope ?? "local"
    internals.log.info("signing out", { scope })

    if (scope === "others") {
      // The current session and its cookie survive: this is the "sign out my
      // other devices" button, and clearing anything locally would be wrong.
      await internals.db.deleteSessions({
        userId: resolved.user.id,
        exceptTokenHash: resolved.tokenHash
      })
      return { data: undefined, status: 204 }
    }

    if (scope === "global") {
      await internals.db.deleteSessions({ userId: resolved.user.id })
    } else {
      await internals.db.deleteSession({ tokenHash: resolved.tokenHash })
    }

    const responseHeaders = new Headers()
    const secure = shouldUseSecureCookies(requestURL)

    if (options.multiAccount && scope === "local") {
      const parked = await pruneDeadAccounts(
        internals,
        readAccountsCookie(internals, headers)
      )
      const [nextActive] = parked

      if (nextActive) {
        const nextSession = await internals.db.getSession({
          tokenHash: await sha256Hex(nextActive)
        })
        const nextUser = nextSession
          ? await internals.db.getUser({ id: nextSession.userId })
          : null

        if (nextUser) {
          responseHeaders.append(
            "set-cookie",
            serializeCookie({
              name: options.cookie.name,
              value: nextActive,
              path: options.cookie.path,
              maxAge: options.session.ttl,
              secure
            })
          )
          responseHeaders.append(
            "set-cookie",
            serializeCookie({
              name: options.cookie.accountsName,
              value: serializeAccounts(promoteAccount(parked, nextActive)),
              path: options.cookie.path,
              maxAge: options.session.ttl,
              secure
            })
          )

          return {
            data: {
              switchedTo: nextUser,
              accessToken: await mintAccessToken(internals, nextUser)
            },
            headers: responseHeaders
          }
        }
      }
    }

    responseHeaders.append(
      "set-cookie",
      clearCookie(options.cookie.name, options.cookie.path, secure)
    )
    if (options.multiAccount) {
      responseHeaders.append(
        "set-cookie",
        clearCookie(options.cookie.accountsName, options.cookie.path, secure)
      )
    }

    return { data: undefined, status: 204, headers: responseHeaders }
  }
})
