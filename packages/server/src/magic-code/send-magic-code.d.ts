import type { MagicCodePurpose } from "../core/auth-db.ts"
import type { AuthServerInternals } from "../core/auth-server-internals.ts"
import type { CodeIdentifier } from "./resolve-code-identifier.ts"
/**
 * How long a magic code is valid.
 *
 * Not configurable: ten minutes is long enough to switch to an email client and
 * short enough that the five-attempt cap and this window together make guessing a
 * six-digit code hopeless. A knob here would only ever be turned the wrong way.
 */
export declare const MAGIC_CODE_TTL = "10m"
/** What sending a code needs to know. */
export interface SendMagicCodeInput {
  identifier: CodeIdentifier
  purpose: MagicCodePurpose
  locale: string
  headers: Headers
}
/**
 * Generates, stores, and delivers a magic code.
 *
 * The code is stored as an HMAC keyed with the server secret, never in plain
 * text and never as a bare hash: six digits is a million possibilities, so an
 * unkeyed digest is reversible from a database read in about a second.
 *
 * Storing it also replaces any live code for that identifier, which is what stops
 * a resend from widening the set of values an attacker may guess.
 *
 * @throws {AuthApiError} `cooldown` or `rateLimited` when throttled.
 */
export declare function sendMagicCode(
  internals: AuthServerInternals,
  input: SendMagicCodeInput
): Promise<void>
//# sourceMappingURL=send-magic-code.d.ts.map
