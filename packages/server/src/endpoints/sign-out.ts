import { AuthApiError } from "../http/auth-api-error"
import { defineEndpoint } from "../http/define-endpoint"
import { reapGuests } from "../lib/sweep-expired"
import type { EndpointDocs } from "../openapi/endpoint-docs"
import type { CallerInput } from "../session/authenticate"
import { authenticate } from "../session/authenticate"
import { resolveSessionRow } from "../session/resolve-session"
import { revokeOtherSessions } from "../session/revoke-other-sessions"
import {
  clearedRefreshCookies,
  readRefreshCookies
} from "../session/session-cookies"

/**
 * How far a sign-out reaches, for each user it applies to.
 *
 * `"local"` is the default because the alternative is a well-known footgun:
 * signing out on a shared computer should not kill the session on your phone.
 */
export type SignOutScope = "local" | "others" | "global"

/** Body accepted by `POST /sign-out`. */
export interface SignOutInput extends CallerInput {
  scope?: SignOutScope
  /**
   * Which of this browser's users to sign out, under `multiUser`.
   *
   * Omit it and every user signed in here goes — the person clicking "sign
   * out" on a shared computer means *everyone*, and a button that quietly left
   * four others one click away would be the surprising behaviour. Name one and
   * only that user goes, whether it is the active one or a parked one; this is
   * what the switcher's per-row sign-out needs, and it is the same id
   * `users/switch` takes.
   *
   * An id that is not signed in here is a 404 rather than a silent no-op.
   */
  userId?: string
  requestURL?: string
}

/** How `POST /sign-out` appears in the OpenAPI document. */
export const signOutDocs: EndpointDocs<SignOutInput> = {
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
          "Under `multiUser`, the one user to sign out. Omit it and every user signed in here goes."
      }
    }
  },
  responses: {
    204: { description: "Signed out.", setsCookie: "cleared" },
    401: "Unauthenticated",
    404: "NotFound"
  }
}

/**
 * Sign out.
 *
 * Two axes, which compose: `scope` says how far each affected user is signed
 * out — this device, other devices, everywhere — and `userId` says whether that
 * applies to the active user alone or to every user parked in this browser.
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

    const scope = input.scope ?? "local"

    // Every user this browser presented, resolved through the same path a
    // request would. A cookie whose session is already gone contributes
    // nothing to revoke but still has a cookie worth clearing.
    const presented = [...readRefreshCookies(internals, headers)]
    const fromCookies = await Promise.all(
      presented.map(async ([userId]) => ({
        userId,
        session: (await resolveSessionRow(internals, headers, userId))?.session
      }))
    )
    // The caller always counts, cookie or not: a bearer-only client — a native
    // app, a server calling in-process — presents none, and signing out is the
    // one thing it must still be able to do. Its session comes from the token,
    // which is authoritative even where the cookie has since been overwritten.
    const signedIn = fromCookies.some(({ userId }) => userId === caller.userId)
      ? fromCookies
      : [...fromCookies, { userId: caller.userId, session: undefined }]

    const targets =
      input.userId === undefined
        ? signedIn
        : signedIn.filter(({ userId }) => userId === input.userId)
    if (targets.length === 0) throw new AuthApiError("notFound", 404)

    internals.log.info("signing out", {
      scope,
      users: input.userId === undefined ? "all" : "one"
    })

    const sessionIdFor = ({ userId, session }: (typeof targets)[number]) =>
      userId === caller.userId ? caller.sessionId : session?.id

    // `others` reaches other devices and never this one, so no cookie moves and
    // whoever is signed in here stays signed in.
    if (scope === "others") {
      for (const target of targets) {
        const sessionId = sessionIdFor(target)
        if (sessionId) {
          await revokeOtherSessions(internals, target.userId, sessionId)
        }
      }
      return { data: undefined, status: 204 }
    }

    const ended = []
    for (const target of targets) {
      const sessionId = sessionIdFor(target)
      if (scope !== "global" && !sessionId) continue
      ended.push(
        ...(await internals.db.delete({
          table: "sessions",
          where:
            scope === "global"
              ? { userId: target.userId }
              : { id: sessionId as string }
        }))
      )
    }
    await reapGuests(internals, ended)

    // One cookie per user, so signing one out clears exactly its own and the
    // rest keep theirs. The hint moves to whoever is left, or retires.
    const responseHeaders = new Headers()
    const context = { requestURL: input.requestURL, headers }
    if (input.userId === undefined) {
      for (const cookie of clearedRefreshCookies(internals, context)) {
        responseHeaders.append("set-cookie", cookie)
      }
    } else {
      for (const cookie of clearedRefreshCookies(internals, {
        ...context,
        userId: input.userId
      })) {
        responseHeaders.append("set-cookie", cookie)
      }
    }

    return { data: undefined, status: 204, headers: responseHeaders }
  }
})
