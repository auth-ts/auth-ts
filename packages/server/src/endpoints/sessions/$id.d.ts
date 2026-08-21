/** Input for revoking one session. */
export interface RevokeSessionInput {
  id: string
  headers?: Headers
  requestURL?: string
}
/**
 * Revokes one of the signed-in user's sessions.
 *
 * Ownership is enforced inside the delete query rather than by comparing ids
 * first: `deleteSession({ id, userId })` filters on both columns, so revoking
 * someone else's session is structurally impossible instead of depending on a
 * check being present.
 */
export declare const revokeSession: import("../../http/define-endpoint.ts").EndpointDefinition<
  RevokeSessionInput,
  undefined
>
//# sourceMappingURL=$id.d.ts.map
