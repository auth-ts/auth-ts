import { DEFAULT_GUESSES } from "../core/auth-config"
import type {
  AuthVerification,
  VerificationPurpose
} from "../core/auth-database"
import type { AuthInternals } from "../core/auth-internals"
import { AuthApiError } from "../http/auth-api-error"
import { checkRateLimit } from "../http/check-rate-limit"
import { scryptVerify, sha256Hex } from "../lib/hash"
import { selectOne } from "../lib/select-one"
import { liveCode } from "./send-verification-code"

/** What verifying a code needs to know. */
export interface ConsumeVerificationCodeInput {
  identifier: string
  code: string
  purpose: VerificationPurpose
  /** The token the send handed out; without one there is nothing to verify against. */
  attempt: string | null
  /** What the guess budget is keyed on: the address for a sign-in, the user for an identity check. */
  guessKey: string
}

/**
 * Finds the code this attempt was sent and checks it, without spending it.
 *
 * Every failure returns the same `invalidCode` error — missing, expired, wrong
 * purpose, wrong attempt, or simply wrong. Distinguishing them would tell an
 * attacker which addresses have codes outstanding.
 *
 * Guesses are limited per address or user once the attempt has found its
 * row, whatever `rateLimit` says, as the author's app charges only a caller
 * holding a live flow. Charging earlier would let anyone without an attempt
 * drain the budget and lock the real user out.
 *
 * The purpose check is what stops a sign-in code from verifying identity and
 * vice versa; without it a code obtained for one flow would silently work in
 * the other.
 *
 * @returns The matching row, for the caller to spend or keep.
 * @throws {AuthApiError} `rateLimited` past the guess budget, `invalidCode` on any other failure.
 */
export async function matchVerificationCode(
  internals: AuthInternals,
  input: ConsumeVerificationCodeInput
): Promise<AuthVerification> {
  const { config } = internals
  if (!input.attempt) throw new AuthApiError("invalidCode")

  const stored = await selectOne(internals, "verifications", {
    identifier: { eq: input.identifier },
    purpose: { eq: input.purpose },
    attemptHash: { eq: await sha256Hex(input.attempt) },
    ...liveCode()
  })
  if (!stored) throw new AuthApiError("invalidCode")

  await checkRateLimit(
    internals,
    `guess:${input.guessKey}`,
    config.rateLimit === false ? DEFAULT_GUESSES : config.rateLimit.guesses
  )

  if (!(await scryptVerify(input.code.toUpperCase(), stored.codeHash))) {
    throw new AuthApiError("invalidCode")
  }

  return stored
}

/**
 * Verifies and spends a verification code.
 *
 * @throws {AuthApiError} `rateLimited` past the guess budget, `invalidCode` on any other failure.
 */
export async function consumeVerificationCode(
  internals: AuthInternals,
  input: ConsumeVerificationCodeInput
) {
  const stored = await matchVerificationCode(internals, input)

  // The conditional delete is what makes the code usable exactly once: two
  // requests can both read the row and both pass the check above, but only
  // one delete finds it.
  const [consumed] = await internals.db.delete({
    table: "verifications",
    where: { id: { eq: stored.id } }
  })
  if (!consumed) throw new AuthApiError("invalidCode")
}
