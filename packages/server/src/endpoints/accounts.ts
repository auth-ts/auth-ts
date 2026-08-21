import type { AuthUser } from "../core/auth-db.ts"
import { notFound, unauthenticated } from "../http/auth-api-error.ts"
import { defineEndpoint } from "../http/define-endpoint.ts"
import { sha256Hex } from "../lib/hash.ts"
import {
  serializeCookie,
  shouldUseSecureCookies
} from "../lib/serialize-cookie.ts"
import {
  pruneDeadAccounts,
  readAccountsCookie,
  serializeAccounts
} from "../session/accounts-cookie.ts"
import { resolveSession } from "../session/resolve-session.ts"

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
    const { options } = internals
    if (!options.multiAccount) throw notFound()

    const headers = input.headers ?? new Headers()
    const active = await resolveSession(internals, headers)
    if (!active) throw unauthenticated()

    const parked = await pruneDeadAccounts(
      internals,
      readAccountsCookie(internals, headers)
    )
    const accounts: AccountInfo[] = [{ user: active.user, current: true }]

    for (const token of parked) {
      const session = await internals.db.getSession({
        tokenHash: await sha256Hex(token)
      })
      if (!session) continue

      const user = await internals.db.getUser({ id: session.userId })
      if (user) accounts.push({ user, current: false })
    }

    const responseHeaders = new Headers()
    responseHeaders.append(
      "set-cookie",
      serializeCookie({
        name: options.cookie.accountsName,
        value: serializeAccounts(parked),
        path: options.cookie.path,
        maxAge: options.session.ttl,
        secure: shouldUseSecureCookies(input.requestURL ?? "https://localhost")
      })
    )

    return { data: { accounts }, headers: responseHeaders }
  }
})
