import type { AuthServerInternals } from "../core/auth-server-internals.ts"
/**
 * A sign-in identifier after normalization, tagged with the channel it arrived on.
 *
 * Tagged rather than a bare string because the channel decides which sender runs
 * and which limits apply; carrying it alongside the value means no downstream
 * step has to re-derive it by guessing at the format.
 */
export interface CodeIdentifier {
  kind: "email" | "phoneNumber"
  value: string
}
/** The body shape shared by `send-code` and `verify-code`. */
export interface IdentifierBody {
  email?: unknown
  phoneNumber?: unknown
}
/**
 * Turns a request body into exactly one normalized, deliverable identifier.
 *
 * The shape of the body *is* the channel selector, so this is the single place
 * that rule is enforced — for both sending and verifying, which is why it lives
 * here rather than inline in either endpoint.
 *
 * @throws {AuthApiError} `invalidField` unless exactly one identifier is present
 * and well formed, or `channelNotConfigured` when this server has no sender for it.
 */
export declare function resolveCodeIdentifier(
  internals: AuthServerInternals,
  body: IdentifierBody
): CodeIdentifier
//# sourceMappingURL=resolve-code-identifier.d.ts.map
