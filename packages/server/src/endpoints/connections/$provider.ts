import { AuthApiError, unauthenticated } from "../../http/auth-api-error.ts"
import { defineEndpoint } from "../../http/define-endpoint.ts"
import { resolveSession } from "../../session/resolve-session.ts"

/** Input for unlinking a provider. */
export interface DisconnectProviderInput {
  provider: string
  headers?: Headers
}

/**
 * Unlinks a provider from the signed-in user.
 *
 * Refuses when it is the last way in. That is the difference between a settings
 * screen and a trapdoor: without it, a user who signed up with GitHub and never
 * added an email can remove GitHub and lock themselves out of their own data.
 *
 * The check is split by who can answer it safely. Email and phone number can
 * never be cleared once set, so if either is present the user keeps a way in no
 * matter what happens to their connections, and a plain delete is fine. Without
 * them the connections are all there is, and "is this the last one" has to be
 * decided by the store, in the same statement as the delete — two concurrent
 * disconnects for different providers would otherwise each see the other still
 * linked, both proceed, and remove every method between them.
 */
export const disconnectProvider = defineEndpoint({
  method: "DELETE",
  path: "/connections/$provider",
  parse: ({ request, params }): DisconnectProviderInput => ({
    provider: params.provider ?? "",
    headers: request.headers
  }),
  run: async (internals, input: DisconnectProviderInput) => {
    const resolved = await resolveSession(
      internals,
      input.headers ?? new Headers()
    )
    if (!resolved) throw unauthenticated()

    const hasOtherMethod = Boolean(
      resolved.user.email || resolved.user.phoneNumber
    )
    const deleted = await internals.db.deleteConnection({
      userId: resolved.user.id,
      provider: input.provider,
      unlessLast: !hasOtherMethod
    })
    if (deleted) return { data: undefined, status: 204 }

    // `null` is either a link that was never there or one the store refused to
    // remove as the last. One read tells them apart.
    const connections = await internals.db.listConnections({
      userId: resolved.user.id
    })
    const stillLinked = connections.some(
      (connection) => connection.provider === input.provider
    )
    if (stillLinked) throw new AuthApiError("lastSignInMethod", 409)
    throw new AuthApiError("notFound", 404)
  }
})
