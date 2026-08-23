import { AuthApiError } from "../../http/auth-api-error"
import { defineEndpoint } from "../../http/define-endpoint"
import type { CallerInput } from "../../session/authenticate"
import { authenticate } from "../../session/authenticate"

/** Input for unlinking a provider. */
export interface DisconnectProviderInput extends CallerInput {
  provider: string
}

/**
 * Unlinks a provider from the signed-in user.
 *
 * There is no "last sign-in method" guard, on purpose. Every user core creates
 * with an identity also has an email — OAuth sign-up requires a verified one —
 * or a phone number, so unlinking the last provider never strands anyone: a
 * code signs them back in, and signing in with the provider again matches on
 * that email and re-records the link on the same account.
 */
export const disconnectProvider = defineEndpoint({
  method: "DELETE",
  path: "/identities/$provider",
  parse: ({ request, params }): DisconnectProviderInput => ({
    provider: params.provider ?? "",
    headers: request.headers
  }),
  run: async (internals, input: DisconnectProviderInput) => {
    const caller = await authenticate(internals, input)

    // Ownership is part of the query, so another user's provider matches
    // nothing and the empty result is the 404.
    const deleted = await internals.db.delete({
      table: "identities",
      where: { userId: caller.userId, provider: input.provider }
    })
    if (deleted.length === 0) throw new AuthApiError("notFound", 404)

    return { data: undefined, status: 204 }
  }
})
