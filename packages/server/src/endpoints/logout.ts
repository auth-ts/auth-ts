import type { AuthUser } from "../core/auth-db.ts"
import type { AuthServerInternals } from "../core/auth-server-internals.ts"
import { unauthenticated } from "../http/auth-api-error.ts"
import { defineEndpoint } from "../http/define-endpoint.ts"
import {
  clearCookie,
  serializeCookie,
  shouldUseSecureCookies
} from "../lib/serialize-cookie.ts"
import type { ParkedAccount } from "../session/accounts-cookie.ts"
import {
  parkedTokens,
  pruneDeadAccounts,
  readAccountsCookie,
  serializeAccounts
} from "../session/accounts-cookie.ts"
import { mintAccessToken } from "../session/issue-session.ts"
import { resolveSession } from "../session/resolve-session.ts"

/**
 * How far a sign-out reaches, for each account it applies to.
 *
 * `"local"` is the default because the alternative is a well-known footgun:
 * signing out on a shared computer should not kill the session on your phone.
 */
export type LogoutScope = "local" | "others" | "global"

/**
 * Which of this browser's accounts a sign-out applies to, under `multiAccount`.
 *
 * `"all"` is the default — the same default Clerk and Better Auth use — because
 * the person clicking "sign out" on a shared computer means *everyone*, and a
 * button that quietly left four other accounts one click away would be the
 * surprising behaviour. `"current"` is the account switcher's "sign out of this
 * one": the active account goes, and the browser moves to the next parked one.
 *
 * Without `multiAccount` there is nothing parked and the two are the same.
 * `scope: "others"` ignores this entirely: it reaches other devices, never
 * other accounts.
 */
export type LogoutAccount = "all" | "current"

/** Body accepted by `POST /logout`. */
export interface LogoutInput {
  scope?: LogoutScope
  account?: LogoutAccount
  headers?: Headers
  requestURL?: string
}

/**
 * Ends sessions.
 *
 * Two axes, which compose: `scope` says how far each affected account is signed
 * out — this device, other devices, everywhere — and `account` says whether that
 * applies to the active account alone or to every account parked in this browser.
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
      account?: LogoutAccount
    }

    return { ...body, headers: request.headers, requestURL: request.url }
  },
  run: async (internals, input: LogoutInput) => {
    const headers = input.headers ?? new Headers()
    const requestURL = input.requestURL ?? "https://localhost"
    const resolved = await resolveSession(internals, headers)
    if (!resolved) throw unauthenticated()

    const { config } = internals
    const scope = input.scope ?? "local"
    const account = input.account ?? "all"
    internals.log.info("signing out", { scope, account })

    if (scope === "others") {
      // The current session and its cookie survive: this is the "sign out my
      // other devices" button, and clearing anything locally would be wrong.
      await internals.db.deleteSessions({
        userId: resolved.user.id,
        exceptTokenHash: resolved.tokenHash
      })
      return { data: undefined, status: 204 }
    }

    const secure = shouldUseSecureCookies(requestURL)
    const parked = config.multiAccount
      ? await pruneDeadAccounts(
          internals,
          readAccountsCookie(internals, headers)
        )
      : []

    // The active account first, as far as scope says. Under `"current"` its
    // other parked sessions in this browser go with it: they are the same
    // account on the same device, and leaving one parked would be a sign-out
    // that signs nobody out.
    if (scope === "global") {
      await internals.db.deleteSessions({ userId: resolved.user.id })
    } else {
      await internals.db.deleteSession({ tokenHash: resolved.tokenHash })
      for (const { session } of parked) {
        if (session.userId === resolved.user.id) {
          await internals.db.deleteSession({ tokenHash: session.tokenHash })
        }
      }
    }
    const others = parked.filter(
      ({ session }) => session.userId !== resolved.user.id
    )

    if (account === "current") {
      const promoted = await promoteNextAccount(internals, others, secure)
      if (promoted) return promoted
    } else {
      // Every other parked account as well — each one exactly as far as the
      // active account went. Rows are revoked, not merely forgotten: a token
      // dropped from the cookie but left live would be a session nobody can
      // see to revoke.
      if (scope === "global") {
        const userIds = new Set(others.map(({ session }) => session.userId))
        for (const userId of userIds) {
          await internals.db.deleteSessions({ userId })
        }
      } else {
        for (const { session } of others) {
          await internals.db.deleteSession({ tokenHash: session.tokenHash })
        }
      }
    }

    const responseHeaders = new Headers()
    responseHeaders.append(
      "set-cookie",
      clearCookie(config.cookie.name, config.cookie.path, secure)
    )
    if (config.multiAccount) {
      responseHeaders.append(
        "set-cookie",
        clearCookie(config.cookie.accountsName, config.cookie.path, secure)
      )
    }

    return { data: undefined, status: 204, headers: responseHeaders }
  }
})

/**
 * Moves the browser to the next parked account, when there is one.
 *
 * The first parked entry whose user still exists becomes active: its token
 * moves into the refresh cookie, the rest stay parked, and a token for it is
 * minted so the client can carry on without a second round-trip.
 *
 * @returns The endpoint result, or `null` when no parked account can take over
 * — in which case the caller clears the cookies instead.
 */
async function promoteNextAccount(
  internals: AuthServerInternals,
  parked: ParkedAccount[],
  secure: boolean
) {
  const { config } = internals

  for (const [index, next] of parked.entries()) {
    const nextUser: AuthUser | null = await internals.db.getUser({
      id: next.session.userId
    })
    if (!nextUser) continue

    const remaining = parkedTokens(parked.filter((_, at) => at !== index))
    const responseHeaders = new Headers()
    responseHeaders.append(
      "set-cookie",
      serializeCookie({
        name: config.cookie.name,
        value: next.token,
        path: config.cookie.path,
        maxAge: config.session.ttl,
        secure
      })
    )
    responseHeaders.append(
      "set-cookie",
      serializeCookie({
        name: config.cookie.accountsName,
        value: serializeAccounts(remaining),
        path: config.cookie.path,
        maxAge: config.session.ttl,
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

  return null
}
