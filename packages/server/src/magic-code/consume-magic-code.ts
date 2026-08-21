import type { AuthMagicCode, MagicCodePurpose } from "../core/auth-db.ts"
import type { AuthServerInternals } from "../core/auth-server-internals.ts"
import { AuthApiError } from "../http/auth-api-error.ts"
import { hmacSha256Hex, timingSafeEqualHex } from "../lib/hash.ts"

/**
 * How many wrong guesses a code survives before it is burned.
 *
 * Five, with a ten-minute lifetime and a per-identifier send limit: guessing six
 * digits needs a hundred thousand attempts on average, and this bounds an
 * attacker to five per code and three codes per ten minutes.
 */
export const MAX_CODE_ATTEMPTS = 5

/** What verifying a code needs to know. */
export interface ConsumeMagicCodeInput {
  identifier: string
  code: string
  purpose: MagicCodePurpose
}

/**
 * Counts a wrong guess against a code, and burns the code at the cap.
 *
 * The counter is a rate-limit row, not a field on the code row, and that is the
 * whole point. `upsertRateLimit` is the one increment the contract requires to
 * be atomic, so fifty parallel wrong guesses count as fifty. A read-then-write
 * on the code row let them count as one — and with the default
 * `trustedProxies: 0` deriving no client IP, nothing stood behind the cap.
 *
 * Keyed on the hash rather than the identifier: a resend is a new code with a
 * fresh budget, and a guess against a superseded code counts only against that
 * code. The window ends when the code does, so the counter is swept with it.
 *
 * This runs even under `rateLimit: false`. That flag turns off the per-IP and
 * per-identifier windows and the cooldown — volume limits a deployment may
 * enforce in front of this server. Five guesses per code is a hard limit on the
 * code's life that nothing in front can enforce, so it is not optional.
 */
async function countWrongGuess(
  internals: AuthServerInternals,
  identifier: string,
  stored: AuthMagicCode
) {
  const counted = await internals.db.upsertRateLimit({
    key: `magicCode:attempts:${stored.codeHash}`,
    resetAt: stored.expiresAt
  })
  if (counted.count < MAX_CODE_ATTEMPTS) return

  // Match on the hash here too: a resend that landed after the row was read
  // is a fresh code with its own budget, and this delete then matches nothing.
  const burned = await internals.db.deleteMagicCode({
    identifier,
    codeHash: stored.codeHash
  })
  if (burned) internals.log.warn("magic code burned after too many attempts")
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
export async function consumeMagicCode(
  internals: AuthServerInternals,
  input: ConsumeMagicCodeInput
) {
  const stored = await internals.db.getMagicCode({
    identifier: input.identifier
  })

  if (
    !stored ||
    stored.expiresAt.getTime() <= Date.now() ||
    stored.purpose !== input.purpose
  ) {
    throw new AuthApiError("invalidCode", 401)
  }

  const presented = await hmacSha256Hex(input.code, internals.options.secret)
  if (!timingSafeEqualHex(presented, stored.codeHash)) {
    await countWrongGuess(internals, input.identifier, stored)
    throw new AuthApiError("invalidCode", 401)
  }

  // The conditional delete is what makes the code usable exactly once. Two
  // requests can both read the row and both pass the check above, but the store
  // lets only one delete a row matching this identifier AND this hash — the
  // other gets null and is rejected. Matching on the hash also means a code
  // issued before a resend can never consume the row the resend created.
  const consumed = await internals.db.deleteMagicCode({
    identifier: input.identifier,
    codeHash: stored.codeHash
  })
  if (!consumed) throw new AuthApiError("invalidCode", 401)
}
