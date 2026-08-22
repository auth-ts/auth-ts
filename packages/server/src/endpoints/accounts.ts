import type { AuthUser } from "../core/auth-db"
import { notFound, unauthenticated } from "../http/auth-api-error"
import { defineEndpoint } from "../http/define-endpoint"
import {
  serializeCookie,
  shouldUseSecureCookies
} from "../lib/serialize-cookie"
import {
  parkedTokens,
  pruneDeadAccounts,
  readAccountsCookie,
  serializeAccounts
} from "../session/accounts-cookie"
import { resolveSession } from "../session/resolve-session"

/** One signed-in user in this browser. */
export interface AccountInfo {
  user: AuthUser
  /** Whether this is the account the browser is currently acting as. */
  current: boolean
}

/** Input for listing accounts. */
export interface ListAccountsInput {
  headers?: Headers
  requestURL?: string
}

/**
 * Lists every user signed in to this browser.
 *
 * The account switcher. Parked tokens whose sessions have died are pruned from
 * the cookie in the same response, so a revoked device stops appearing here
 * immediately rather than lingering until someone clicks it.
 *
 * Note the terminology, which is easy to blur: `/sessions` is one user's devices,
 * `/accounts` is one browser's users, and `/connections` is one user's linked
 * providers.
 */
export const listAccounts = defineEndpoint({
  method: "GET",
  path: "/accounts",
  parse: ({ request }): ListAccountsInput => ({
    headers: request.headers,
    requestURL: request.url
  }),
  run: async (internals, input: ListAccountsInput) => {
    const { config } = internals
    if (!config.multiAccount) throw notFound()

    const headers = input.headers ?? new Headers()
    const active = await resolveSession(internals, headers)
    if (!active) throw unauthenticated()

    const parked = await pruneDeadAccounts(
      internals,
      readAccountsCookie(internals, headers)
    )
    // The prune already read each session, so only the users are left to
    // fetch — and those concurrently, for the same reason the prune is.
    const parkedUsers = await Promise.all(
      parked.map(({ session }) => internals.db.getUser({ id: session.userId }))
    )
    const accounts: AccountInfo[] = [{ user: active.user, current: true }]
    for (const user of parkedUsers) {
      if (user) accounts.push({ user, current: false })
    }

    const responseHeaders = new Headers()
    responseHeaders.append(
      "set-cookie",
      serializeCookie({
        name: config.cookie.accountsName,
        value: serializeAccounts(parkedTokens(parked)),
        path: config.cookie.path,
        maxAge: config.session.ttl,
        secure: shouldUseSecureCookies(input.requestURL ?? "https://localhost")
      })
    )

    return { data: { accounts }, headers: responseHeaders }
  }
})
