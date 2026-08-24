import type { AuthUser } from "../core/auth-db"
import { notFound, unauthenticated } from "../http/auth-api-error"
import { defineEndpoint } from "../http/define-endpoint"
import { selectOne } from "../lib/select-one"
import {
  serializeCookie,
  shouldUseSecureCookies
} from "../lib/serialize-cookie"
import type { EndpointDocs } from "../openapi/endpoint-docs"
import {
  parkedTokens,
  pruneDeadAccounts,
  readAccountsCookie,
  serializeAccounts
} from "../session/accounts-cookie"
import type { CallerInput } from "../session/authenticate"
import { authenticate } from "../session/authenticate"

/**
 * One signed-in user in this browser.
 *
 * Which of them is active is the caller's comparison: `getUser` already says
 * who that is, so a flag here would be the same answer written twice.
 */
export type AccountInfo = AuthUser

/** Input for listing accounts. */
export interface ListAccountsInput extends CallerInput {
  requestURL?: string
}

/** How `GET /accounts` appears in the OpenAPI document. */
export const listAccountsDocs: EndpointDocs<ListAccountsInput> = {
  description:
    "The account switcher. Parked tokens whose sessions have died are pruned in the same response, so a revoked device stops appearing immediately. Note the three: `/sessions` is one user's devices, `/accounts` is one browser's users, `/identities` is one user's linked providers.",
  tag: "Accounts",
  auth: "bearer",
  requires: "multiAccount",
  responses: {
    200: {
      description: "Every user signed in to this browser.",
      setsCookie: "accounts",
      schema: { type: "array", items: "Account" }
    },
    401: "Unauthenticated"
  }
}

/**
 * Lists every user signed in to this browser.
 *
 * The account switcher. Parked tokens whose sessions have died are pruned from
 * the cookie in the same response, so a revoked device stops appearing here
 * immediately rather than lingering until someone clicks it.
 *
 * Note the terminology, which is easy to blur: `/sessions` is one user's devices,
 * `/accounts` is one browser's users, and `/identities` is one user's linked
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
    const caller = await authenticate(internals, input)
    const active = await selectOne(internals, "users", { id: caller.userId })
    if (!active) throw unauthenticated()

    const parked = await pruneDeadAccounts(
      internals,
      readAccountsCookie(internals, headers)
    )
    // The prune already read each session, so only the users are left to
    // fetch — and those concurrently, for the same reason the prune is.
    const parkedUsers = await Promise.all(
      parked.map(({ session }) =>
        selectOne(internals, "users", { id: session.userId })
      )
    )
    const accounts: AccountInfo[] = [active]
    for (const user of parkedUsers) {
      if (user) accounts.push(user)
    }

    const responseHeaders = new Headers()
    responseHeaders.append(
      "set-cookie",
      serializeCookie({
        name: config.cookie.accountsName,
        value: serializeAccounts(parkedTokens(parked)),
        path: config.cookie.path,
        maxAge: config.session.ttl,
        secure: shouldUseSecureCookies(input.requestURL)
      })
    )

    return { data: accounts, headers: responseHeaders }
  }
})
