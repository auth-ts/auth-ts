import { AuthApiError, unauthenticated } from "../../http/auth-api-error"
import { defineEndpoint } from "../../http/define-endpoint"
import { resolveSession } from "../../session/resolve-session"

/** Input for unlinking a provider. */
export interface DisconnectProviderInput {
  provider: string
  headers?: Headers
}

/**
 * Unlinks a provider from the signed-in user.
 *
 * There is no "last sign-in method" guard, on purpose. Every user core creates
 * with a connection also has an email — OAuth sign-up requires a verified one —
 * or a phone number, so unlinking the last provider never strands anyone: a
 * code signs them back in, and signing in with the provider again matches on
 * that email and re-records the link on the same account.
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

    const deleted = await internals.db.deleteConnection({
      userId: resolved.user.id,
      provider: input.provider
    })
    if (!deleted) throw new AuthApiError("notFound", 404)

    return { data: undefined, status: 204 }
  }
})
