import type { AuthUser } from "../core/auth-db"
import type { AuthServerInternals } from "../core/auth-server-internals"
import { unauthenticated } from "../http/auth-api-error"
import { defineEndpoint } from "../http/define-endpoint"
import { selectOne } from "../lib/select-one"
import {
  clearCookie,
  serializeCookie,
  shouldUseSecureCookies
} from "../lib/serialize-cookie"
import type { ParkedAccount } from "../session/accounts-cookie"
import {
  parkedTokens,
  pruneDeadAccounts,
  readAccountsCookie,
  serializeAccounts
} from "../session/accounts-cookie"
import { mintAccessToken } from "../session/issue-session"
import { resolveSession } from "../session/resolve-session"
import { revokeOtherSessions } from "../session/revoke-other-sessions"

/**
 * How far a sign-out reaches, for each account it applies to.
 *
 * `"local"` is the default because the alternative is a well-known footgun:
 * signing out on a shared computer should not kill the session on your phone.
 */
export type SignOutScope = "local" | "others" | "global"

/**
 * Which of this browser's accounts a sign-out applies to, under `multiAccount`.
 *
 * `"all"` is the default — the same default Clerk uses — because
 * the person clicking "sign out" on a shared computer means *everyone*, and a
 * button that quietly left four other accounts one click away would be the
 * surprising behaviour. `"current"` is the account switcher's "sign out of this
 * one": the active account goes, and the browser moves to the next parked one.
 *
 * Without `multiAccount` there is nothing parked and the two are the same.
 * `scope: "others"` ignores this entirely: it reaches other devices, never
 * other accounts.
 */
export type SignOutAccount = "all" | "current"

/** Body accepted by `POST /sign-out`. */
export interface SignOutInput {
  scope?: SignOutScope
  account?: SignOutAccount
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
export const signOut = defineEndpoint({
  method: "POST",
  path: "/sign-out",
  parse: async ({ request }): Promise<SignOutInput> => {
    const body = (await request.json().catch(() => ({}))) as {
      scope?: SignOutScope
      account?: SignOutAccount
    }

    return { ...body, headers: request.headers, requestURL: request.url }
  },
  run: async (internals, input: SignOutInput) => {
    const headers = input.headers ?? new Headers()
    const resolved = await resolveSession(internals, headers)
    if (!resolved) throw unauthenticated()

    const { config } = internals
    const scope = input.scope ?? "local"
    const account = input.account ?? "all"
    internals.log.info("signing out", { scope, account })

    if (scope === "others") {
      // The current session and its cookie survive: this is the "sign out my
      // other devices" button, and clearing anything locally would be wrong.
      await revokeOtherSessions(internals, resolved.user.id, resolved.tokenHash)
      return { data: undefined, status: 204 }
    }

    const secure = shouldUseSecureCookies(input.requestURL)
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
      await internals.db.delete({
        table: "sessions",
        where: { userId: resolved.user.id }
      })
    } else {
      await deleteSessionByToken(internals, resolved.tokenHash)
      for (const { session } of parked) {
        if (session.userId === resolved.user.id) {
          await deleteSessionByToken(internals, session.tokenHash)
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
          await internals.db.delete({ table: "sessions", where: { userId } })
        }
      } else {
        for (const { session } of others) {
          await deleteSessionByToken(internals, session.tokenHash)
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
    const nextUser: AuthUser | null = await selectOne(internals, "users", {
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

/** Deletes one session by its token hash — the shape most sign-outs need. */
function deleteSessionByToken(
  internals: AuthServerInternals,
  tokenHash: string
) {
  return internals.db.delete({ table: "sessions", where: { tokenHash } })
}
