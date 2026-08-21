import type { MagicCodePurpose } from "../core/auth-db.ts"
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
    const attempts = stored.attempts + 1

    if (attempts >= MAX_CODE_ATTEMPTS) {
      await internals.db.deleteMagicCode({ identifier: input.identifier })
      internals.log.warn("magic code burned after too many attempts")
    } else {
      // Read-then-write, so two simultaneous wrong guesses can undercount by one.
      // Accepted: the HMAC, the ten-minute window, and the per-IP verify limit are
      // the real throttles; making this atomic would mean a new callback for every
      // consumer to implement correctly.
      await internals.db.upsertMagicCode({ ...stored, attempts })
    }

    throw new AuthApiError("invalidCode", 401)
  }

  await internals.db.deleteMagicCode({ identifier: input.identifier })
}
