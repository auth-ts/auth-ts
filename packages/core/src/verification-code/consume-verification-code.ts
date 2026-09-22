import type { VerificationPurpose } from "../core/auth-database"
import type { AuthInternals } from "../core/auth-internals"
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
const MAX_CODE_ATTEMPTS = 5

/** What verifying a code needs to know. */
export interface ConsumeVerificationCodeInput {
  identifier: string
  code: string
  purpose: VerificationPurpose
}

/**
 * Verifies and burns a verification code.
 *
 * Every failure returns the same `invalidCode` error — missing, expired, wrong
 * purpose, or simply wrong. Distinguishing them would tell an attacker which
 * addresses have codes outstanding.
 *
 * The purpose check is what stops a sign-in code from authorizing account
 * deletion and vice versa; both are codes for the same identifier, so without
 * it a code obtained for one flow would silently work in the other.
 *
 * A guess is counted before it is checked. The budget is a row per guess in
 * `attempts`, keyed on the code's hash: guesses only ever insert, so fifty in
 * parallel count as fifty, and a resend is a new code with a fresh budget. The
 * rows expire when the code does. Counting runs even under `rateLimit: false` —
 * that flag turns off the volume windows a deployment may enforce in front of
 * this server, and five guesses per code is not one of those.
 *
 * @throws {AuthApiError} `invalidCode` on any failure.
 */
export async function consumeVerificationCode(
  internals: AuthInternals,
  input: ConsumeVerificationCodeInput
) {
  // Newest first: a resend leaves the previous code dead but not necessarily
  // gone, and the code the person is holding is the one sent last.
  const stored = await selectOne(
    internals,
    "verifications",
    { identifier: { eq: input.identifier }, purpose: { eq: input.purpose } },
    { expiresAt: "desc" }
  )

  if (!stored || stored.purpose !== input.purpose) {
    throw new AuthApiError("invalidCode")
  }

  if (stored.expiresAt.getTime() <= Date.now()) {
    // Already in hand, so delete it rather than leave it for the sweep.
    await internals.db.delete({
      table: "verifications",
      where: { id: { eq: stored.id } }
    })
    throw new AuthApiError("invalidCode")
  }

  const counted = await countAttempt(
    internals,
    `verificationCode:attempts:${stored.codeHash}`,
    stored.expiresAt,
    MAX_CODE_ATTEMPTS
  )
  const presented =
    counted > MAX_CODE_ATTEMPTS
      ? null
      : await hmacSha256Hex(input.code, internals.config.secret)

  if (presented === null || !timingSafeEqualHex(presented, stored.codeHash)) {
    if (counted >= MAX_CODE_ATTEMPTS) {
      // Match on the hash here too: a resend that landed after the row was
      // read is a fresh code with its own budget, and this delete then matches
      // nothing.
      const [burned] = await internals.db.delete({
        table: "verifications",
        where: {
          identifier: { eq: input.identifier },
          codeHash: { eq: stored.codeHash }
        }
      })
      if (burned)
        internals.log.warn("verification code burned after too many attempts")
    }
    throw new AuthApiError("invalidCode")
  }

  // The conditional delete is what makes the code usable exactly once. Two
  // requests can both read the row and both pass the check above, but the store
  // lets only one delete a row matching this identifier AND this hash — the
  // other gets nothing back and is rejected. Matching on the hash also means a
  // code issued before a resend can never consume the row the resend created.
  const [consumed] = await internals.db.delete({
    table: "verifications",
    where: {
      identifier: { eq: input.identifier },
      codeHash: { eq: stored.codeHash }
    }
  })
  if (!consumed) throw new AuthApiError("invalidCode")
}
