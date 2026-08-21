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
 * Refuses when it is the last way in. Counting the remaining methods — email,
 * phone number, and any other linked provider — is the difference between a
 * settings screen and a trapdoor: without this check, a user who signed up with
 * GitHub and never added an email can remove GitHub and lock themselves out of
 * their own data permanently.
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

    const connections = await internals.db.listConnections({
      userId: resolved.user.id
    })
    if (
      !connections.some((connection) => connection.provider === input.provider)
    ) {
      throw new AuthApiError("notFound", 404)
    }

    const remainingMethods =
      (resolved.user.email ? 1 : 0) +
      (resolved.user.phoneNumber ? 1 : 0) +
      connections.filter((connection) => connection.provider !== input.provider)
        .length

    if (remainingMethods === 0) throw new AuthApiError("lastSignInMethod", 409)

    await internals.db.deleteConnection({
      userId: resolved.user.id,
      provider: input.provider
    })

    return { data: undefined, status: 204 }
  }
})
