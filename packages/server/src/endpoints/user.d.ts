import type { HeadersInput } from "../session/resolve-session.ts"
/**
 * Reads the signed-in user.
 *
 * A cheap whoami for server-side rendering and app boot: it resolves the session
 * and returns the user without minting a token.
 */
export declare const getUser: import("../http/define-endpoint.ts").EndpointDefinition<
  HeadersInput,
  {
    user: import("../index.ts").AuthUser
  }
>
/**
 * The flat body accepted by `PATCH /user`.
 *
 * Flat because for this endpoint the whole payload *is* user fields — there are
 * no credentials mixed in, unlike sign-up, which is why sign-up keeps
 * `additionalFields` nested and this does not.
 */
export interface UpdateUserInput {
  name?: string
  imageURL?: string
  headers?: Headers
  [field: string]: unknown
}
/**
 * Updates the fields core owns, plus any declared additional fields.
 *
 * `email` and `phoneNumber` are rejected rather than updated. An identifier is
 * the anchor every sign-in resolves to, so changing one re-keys the account —
 * that is a ceremony with a code verified at the *new* address, not a field you
 * can PATCH. `type` is rejected for the obvious reason: it would be
 * self-promotion to admin.
 */
export declare const updateUser: import("../http/define-endpoint.ts").EndpointDefinition<
  UpdateUserInput,
  {
    user: import("../index.ts").AuthUser
  }
>
/** Body accepted by `DELETE /user`. */
export interface DeleteUserInput {
  /** The confirmation code, when a challenge was issued. */
  code?: string
  headers?: Headers
  requestURL?: string
}
/**
 * Deletes the signed-in account.
 *
 * Two phases, in one endpoint. A session that authenticated recently deletes
 * immediately; an older one is challenged with a code first.
 *
 * The challenge deliberately answers 403 rather than 202: **204 must be the only
 * success shape**, or a client that treats any 2xx as done will clear its state
 * and tell the user their account is gone while it very much is not.
 */
export declare const deleteUser: import("../http/define-endpoint.ts").EndpointDefinition<
  DeleteUserInput,
  undefined
>
//# sourceMappingURL=user.d.ts.map
