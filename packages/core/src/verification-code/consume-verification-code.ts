import { DEFAULT_GUESS_LIMIT } from "../core/auth-config"
import type { VerificationPurpose } from "../core/auth-database"
import type { AuthInternals } from "../core/auth-internals"
import { AuthApiError } from "../http/auth-api-error"
import { checkRateLimit } from "../http/check-rate-limit"
import { hmacSha256Hex, sha256Hex, timingSafeEqualHex } from "../lib/hash"
import { selectOne } from "../lib/select-one"

/** What verifying a code needs to know. */
export interface ConsumeVerificationCodeInput {
  identifier: string
  code: string
  purpose: VerificationPurpose
  /** The token the send handed out; without one there is nothing to verify against. */
  attempt: string | null
}

/**
 * Verifies and spends a verification code.
 *
 * Every failure returns the same `invalidCode` error — missing, expired, wrong
 * purpose, wrong attempt, or simply wrong. Distinguishing them would tell an
 * attacker which addresses have codes outstanding.
 *
 * Guesses are limited per identifier before anything is read, whatever
 * `rateLimit` says: a code is bound to its requester, so this budget is the
 * only one an attacker can spend against an address, and it has to hold even
 * when the per-IP windows are handled in front of the server.
 *
 * The purpose check is what stops a sign-in code from authorizing account
 * deletion and vice versa; both are codes for the same identifier, so without
 * it a code obtained for one flow would silently work in the other.
 *
 * @throws {AuthApiError} `rateLimited` past the guess budget, `invalidCode` on any other failure.
 */
export async function consumeVerificationCode(
  internals: AuthInternals,
  input: ConsumeVerificationCodeInput
) {
  const { config } = internals
  await checkRateLimit(
    internals,
    `${input.purpose}:guess:${input.identifier}`,
    config.rateLimit === false
      ? DEFAULT_GUESS_LIMIT
      : config.rateLimit.guessPerIdentifier
  )

  if (!input.attempt) throw new AuthApiError("invalidCode")

  const stored = await selectOne(internals, "verifications", {
    identifier: { eq: input.identifier },
    purpose: { eq: input.purpose },
    attemptHash: { eq: await sha256Hex(input.attempt) },
    expiresAt: { gt: new Date() }
  })
  if (!stored) throw new AuthApiError("invalidCode")

  const presented = await hmacSha256Hex(input.code.toUpperCase(), config.secret)
  if (!timingSafeEqualHex(presented, stored.codeHash)) {
    throw new AuthApiError("invalidCode")
  }

  // The conditional delete is what makes the code usable exactly once: two
  // requests can both read the row and both pass the check above, but only
  // one delete finds it.
  const [consumed] = await internals.db.delete({
    table: "verifications",
    where: { id: { eq: stored.id } }
  })
  if (!consumed) throw new AuthApiError("invalidCode")
}
