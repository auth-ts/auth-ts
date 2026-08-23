import { AuthApiError } from "../../http/auth-api-error"
import { defineEndpoint } from "../../http/define-endpoint"
import type { CallerInput } from "../../session/authenticate"
import { authenticate } from "../../session/authenticate"

/** Input for unlinking an identity. */
export interface DisconnectIdentityInput extends CallerInput {
  /** The identity's own id, from `GET /identities`. */
  id: string
}

/**
 * Unlinks one connected account from the signed-in user.
 *
 * Addressed by identity id rather than by provider, because a user may connect
 * several accounts at the same provider — two Google addresses, a personal and
 * a work GitHub — and "disconnect Google" would take all of them.
 *
 * There is no "last sign-in method" guard, on purpose. Every user core creates
 * with an identity also has an email — OAuth sign-up requires a verified one —
 * or a phone number, so unlinking the last provider never strands anyone: a
 * code signs them back in, and signing in with the provider again matches on
 * that email and re-records the link on the same account.
 *
 * The stored provider tokens go with the row. Nothing is revoked at the
 * provider: that is the user's to do from the provider's own account screen,
 * and a revocation call that failed would leave this side lying either way.
 */
export const disconnectIdentity = defineEndpoint({
  method: "DELETE",
  path: "/identities/$id",
  parse: ({ request, params }): DisconnectIdentityInput => ({
    id: params.id ?? "",
    headers: request.headers
  }),
  run: async (internals, input: DisconnectIdentityInput) => {
    const caller = await authenticate(internals, input)

    // Ownership is part of the query, so another user's identity matches
    // nothing and the empty result is the 404.
    const deleted = await internals.db.delete({
      table: "identities",
      where: { id: input.id, userId: caller.userId }
    })
    if (deleted.length === 0) throw new AuthApiError("notFound", 404)

    return { data: undefined, status: 204 }
  }
})
