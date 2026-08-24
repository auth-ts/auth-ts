import { AuthApiError } from "../http/auth-api-error"
import { defineEndpoint } from "../http/define-endpoint"
import {
  clearCookie,
  serializeCookie,
  shouldUseSecureCookies
} from "../lib/serialize-cookie"
import { reapGuests } from "../lib/sweep-expired"
import type { EndpointDocs } from "../openapi/endpoint-docs"
import {
  parkedTokens,
  pruneDeadAccounts,
  readAccountsCookie,
  serializeAccounts
} from "../session/accounts-cookie"
import type { CallerInput } from "../session/authenticate"
import { authenticate } from "../session/authenticate"
import { mintAccessToken } from "../session/issue-session"
import { promoteNextAccount } from "../session/promote-account"
import { revokeOtherSessions } from "../session/revoke-other-sessions"
import { clearedRefreshCookies } from "../session/session-cookies"

/**
 * How far a sign-out reaches, for each account it applies to.
 *
 * `"local"` is the default because the alternative is a well-known footgun:
 * signing out on a shared computer should not kill the session on your phone.
 */
export type SignOutScope = "local" | "others" | "global"

/** Body accepted by `POST /sign-out`. */
export interface SignOutInput extends CallerInput {
  scope?: SignOutScope
  /**
   * Which of this browser's accounts to sign out, under `multiAccount`.
   *
   * Omit it and every account signed in here goes — the person clicking "sign
   * out" on a shared computer means *everyone*, and a button that quietly left
   * four other accounts one click away would be the surprising behaviour. Name
   * one and only that account goes, whether it is the active one or a parked
   * one; this is what the account switcher's per-row sign-out needs, and it is
   * the same id `accounts/switch` takes.
   *
   * An id that is not signed in here is a 404 rather than a silent no-op.
   */
  userId?: string
  requestURL?: string
}

/** How `POST /sign-out` appears in the OpenAPI document. */
export const signOutDocs: EndpointDocs<SignOutInput> = {
  description:
    "Signs out this device by default. Use scope for other devices, and userId for one account.",
  tag: "Session",
  auth: "bearer",
  body: {
    type: "object",
    properties: {
      scope: {
        type: "string",
        enum: ["local", "others", "global"],
        description:
          "This device, other devices, or everywhere. Defaults to `local`."
      },
      userId: {
        type: "string",
        description:
          "Under `multiAccount`, the one account to sign out. Omit it and every account signed in here goes."
      }
    }
  },
  responses: {
    200: {
      description:
        "Signing out promoted another account parked in this browser.",
      setsCookie: "refresh",
      schema: "SignOutResult"
    },
    204: {
      description: "Signed out, with no account left to promote.",
      setsCookie: "cleared"
    },
    401: "Unauthenticated",
    404: "NotFound"
  }
}

/**
 * Signs out.
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
      userId?: string
    }

    return { ...body, headers: request.headers, requestURL: request.url }
  },
  run: async (internals, input: SignOutInput) => {
    const headers = input.headers ?? new Headers()
    const caller = await authenticate(internals, input)

    const { config } = internals
    const scope = input.scope ?? "local"
    const secure = shouldUseSecureCookies(input.requestURL)
    const context = { requestURL: input.requestURL, headers }

    const parked = config.multiAccount
      ? await pruneDeadAccounts(
          internals,
          readAccountsCookie(internals, headers)
        )
      : []

    // Everything signed in here, the active account first. A parked entry for
    // the account already active is one of its sessions, not another account.
    const accounts = [
      { userId: caller.userId, sessionId: caller.sessionId },
      ...parked.map(({ session }) => ({
        userId: session.userId,
        sessionId: session.id
      }))
    ]

    const targets =
      input.userId === undefined
        ? accounts
        : accounts.filter(({ userId }) => userId === input.userId)
    if (targets.length === 0) throw new AuthApiError("notFound", 404)

    internals.log.info("signing out", {
      scope,
      accounts: input.userId === undefined ? "all" : "one"
    })

    // `others` reaches other devices and never this one, so no cookie moves and
    // whoever is signed in here stays signed in.
    if (scope === "others") {
      for (const target of targets) {
        await revokeOtherSessions(internals, target.userId, target.sessionId)
      }
      return { data: undefined, status: 204 }
    }

    const ended = []
    for (const target of targets) {
      ended.push(
        ...(await internals.db.delete({
          table: "sessions",
          where:
            scope === "global"
              ? { userId: target.userId }
              : { id: target.sessionId }
        }))
      )
    }
    await reapGuests(internals, ended)

    const signedOut = new Set(targets.map(({ userId }) => userId))
    const remaining = parked.filter(
      ({ session }) => !signedOut.has(session.userId)
    )

    // The active account survived, so only the parked list changed.
    if (!signedOut.has(caller.userId)) {
      const responseHeaders = new Headers()
      responseHeaders.append(
        "set-cookie",
        serializeCookie({
          name: config.cookie.accountsName,
          value: serializeAccounts(parkedTokens(remaining)),
          path: config.cookie.path,
          maxAge: config.session.ttl,
          secure
        })
      )
      return { data: undefined, status: 204, headers: responseHeaders }
    }

    const promoted = await promoteNextAccount(internals, remaining, context)
    if (promoted) {
      // The browser is now acting as someone else, so it gets that account's
      // token. Signing out without a promotion returns none: handing over a
      // fresh credential on the way out would be perverse.
      const token = await mintAccessToken(
        internals,
        promoted.user,
        promoted.session.id
      )

      return {
        data: { switchedTo: promoted.user, token },
        headers: promoted.headers
      }
    }

    const responseHeaders = new Headers()
    for (const cookie of clearedRefreshCookies(internals, context)) {
      responseHeaders.append("set-cookie", cookie)
    }
    if (config.multiAccount) {
      responseHeaders.append(
        "set-cookie",
        clearCookie(config.cookie.accountsName, config.cookie.path, secure)
      )
    }

    return { data: undefined, status: 204, headers: responseHeaders }
  }
})
