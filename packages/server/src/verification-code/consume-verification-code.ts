import type { AuthOTP, OTPAction } from "../core/auth-db"
import type { AuthServerInternals } from "../core/auth-server-internals"
import { AuthApiError } from "../http/auth-api-error"
import { countAttempt } from "../http/check-rate-limit"
import { hmacSha256Hex, timingSafeEqualHex } from "../lib/hash"
import { selectOne } from "../lib/select-one"

/**
 * How many wrong guesses a code survives before it is burned.
 *
 * Five, with a ten-minute lifetime and a per-identifier send limit: guessing six
 * digits needs a hundred thousand attempts on average, and this bounds an
 * attacker to five per code and three codes per ten minutes.
 */
export const MAX_CODE_ATTEMPTS = 5

/** What verifying a code needs to know. */
export interface ConsumeVerificationCodeInput {
  identifier: string
  code: string
  action: OTPAction
}

/**
 * Counts a wrong guess against a code, and burns the code at the cap.
 *
 * The budget is a row per guess in `attempts`, not a field on the code row.
 * Guesses only ever insert, so fifty parallel wrong guesses leave fifty rows
 * and count as fifty; a counter on the code row would need a read and a write,
 * and fifty parallel ones would count as one.
 *
 * Keyed on the hash rather than the identifier: a resend is a new code with a
 * fresh budget, and a guess against a superseded code counts only against that
 * code. The rows expire when the code does, so they are swept with it.
 *
 * This runs even under `rateLimit: false`. That flag turns off the per-IP and
 * per-identifier windows and the cooldown — volume limits a deployment may
 * enforce in front of this server. Five guesses per code is a hard limit on the
 * code's life that nothing in front can enforce, so it is not optional.
 */
async function countWrongGuess(
  internals: AuthServerInternals,
  identifier: string,
  stored: AuthOTP
) {
  const counted = await countAttempt(
    internals,
    `verificationCode:attempts:${stored.codeHash}`,
    stored.expiresAt,
    MAX_CODE_ATTEMPTS
  )
  if (counted < MAX_CODE_ATTEMPTS) return

  // Match on the hash here too: a resend that landed after the row was read
  // is a fresh code with its own budget, and this delete then matches nothing.
  const [burned] = await internals.db.delete({
    table: "otps",
    where: { identifier, codeHash: stored.codeHash }
  })
  if (burned)
    internals.log.warn("verification code burned after too many attempts")
}

/**
 * Verifies and burns a verification code.
 *
 * Every failure returns the same `invalidCode` error — missing, expired, wrong
 * action, or simply wrong. Distinguishing them would tell an attacker which
 * addresses have codes outstanding.
 *
 * The action check is what stops a sign-in code from authorizing account
 * deletion and vice versa; both are codes for the same identifier, so without
 * it a code obtained for one flow would silently work in the other.
 *
 * @throws {AuthApiError} `invalidCode` on any failure.
 */
export async function consumeVerificationCode(
  internals: AuthServerInternals,
  input: ConsumeVerificationCodeInput
) {
  // Newest first: a resend leaves the previous code dead but not necessarily
  // gone, and the code the person is holding is the one sent last.
  const stored = await selectOne(
    internals,
    "otps",
    { identifier: input.identifier },
    { expiresAt: "desc" }
  )

  if (!stored || stored.action !== input.action) {
    throw new AuthApiError("invalidCode", 401)
  }

  if (stored.expiresAt.getTime() <= Date.now()) {
    // Already in hand, so delete it rather than leave it for the sweep.
    await internals.db.delete({
      table: "otps",
      where: { id: stored.id }
    })
    throw new AuthApiError("invalidCode", 401)
  }

  const presented = await hmacSha256Hex(input.code, internals.config.secret)
  if (!timingSafeEqualHex(presented, stored.codeHash)) {
    await countWrongGuess(internals, input.identifier, stored)
    throw new AuthApiError("invalidCode", 401)
  }

  // The conditional delete is what makes the code usable exactly once. Two
  // requests can both read the row and both pass the check above, but the store
  // lets only one delete a row matching this identifier AND this hash — the
  // other gets nothing back and is rejected. Matching on the hash also means a
  // code issued before a resend can never consume the row the resend created.
  const [consumed] = await internals.db.delete({
    table: "otps",
    where: { identifier: input.identifier, codeHash: stored.codeHash }
  })
  if (!consumed) throw new AuthApiError("invalidCode", 401)
}
