import type { MagicCodePurpose } from "../core/auth-db.ts"
import type { AuthServerInternals } from "../core/auth-server-internals.ts"
/**
 * How many wrong guesses a code survives before it is burned.
 *
 * Five, with a ten-minute lifetime and a per-identifier send limit: guessing six
 * digits needs a hundred thousand attempts on average, and this bounds an
 * attacker to five per code and three codes per ten minutes.
 */
export declare const MAX_CODE_ATTEMPTS = 5
/** What verifying a code needs to know. */
export interface ConsumeMagicCodeInput {
  identifier: string
  code: string
  purpose: MagicCodePurpose
}
/**
 * Verifies and burns a magic code.
 *
 * Every failure returns the same `invalidCode` error — missing, expired, wrong
 * purpose, or simply wrong. Distinguishing them would tell an attacker which
 * addresses have codes outstanding.
 *
 * The purpose check is what stops a sign-in code from authorizing account
 * deletion and vice versa; both live in the same row, so without it a code
 * obtained for one flow would silently work in the other.
 *
 * @throws {AuthApiError} `invalidCode` on any failure.
 */
export declare function consumeMagicCode(
  internals: AuthServerInternals,
  input: ConsumeMagicCodeInput
): Promise<void>
//# sourceMappingURL=consume-magic-code.d.ts.map
