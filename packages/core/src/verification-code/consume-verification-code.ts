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
  /** Required where a code is bound to more than its attempt: the session, for identity. */
  identifier?: string
  code: string
  purpose: VerificationPurpose
  /** The token the send handed out; without one there is nothing to verify against. */
  attempt: string | null
  /** What the guess budget is keyed on; the row's identifier when omitted. */
  guessKey?: string
}

/**
 * Finds the code this attempt was sent and checks it, without spending it.
 *
 * A wrong code is `incorrectCode`, as the author's app answers; everything
 * else — no attempt, expired, spent, another purpose or another client's
 * attempt — is `invalidCode`. The row is found by the caller's own attempt,
 * so the split says nothing about anyone else's codes.
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
 * @throws {AuthApiError} `rateLimited` past the guess budget, `incorrectCode` for a wrong code, `invalidCode` on any other failure.
 */
export async function matchVerificationCode(
  internals: AuthInternals,
  input: ConsumeVerificationCodeInput
): Promise<AuthVerification> {
  const { config } = internals
  if (!input.attempt) throw new AuthApiError("invalidCode")

  const stored = await selectOne(internals, "verifications", {
    attemptHash: { eq: await sha256Hex(input.attempt) },
    purpose: { eq: input.purpose },
    ...(input.identifier === undefined
      ? {}
      : { identifier: { eq: input.identifier } }),
    ...liveCode()
  })
  // An identity marker keeps its row but no longer holds a code
  if (!stored?.codeHash.startsWith("$scrypt$")) {
    throw new AuthApiError("invalidCode")
  }

  await checkRateLimit(
    internals,
    `guess:${input.guessKey ?? stored.identifier}`,
    config.rateLimit === false ? DEFAULT_GUESSES : config.rateLimit.guesses
  )

  const code = input.code.replaceAll(" ", "").replaceAll("-", "").toUpperCase()
  if (!(await scryptVerify(code, stored.codeHash))) {
    internals.log.info("verification code rejected", { purpose: input.purpose })
    throw new AuthApiError("incorrectCode")
  }

  return stored
}

/**
 * Verifies and spends a verification code.
 *
 * @throws {AuthApiError} `rateLimited` past the guess budget, `incorrectCode` for a wrong code, `invalidCode` on any other failure.
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

  return stored
}
