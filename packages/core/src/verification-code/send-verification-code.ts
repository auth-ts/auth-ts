import type { VerificationPurpose } from "../core/auth-database"
import type { AuthInternals } from "../core/auth-internals"
import { AuthApiError } from "../http/auth-api-error"
import { checkRateLimit } from "../http/check-rate-limit"
import { randomBytesBase64url, randomCode } from "../lib/generate-random"
import { scryptHash, sha256Hex } from "../lib/hash"
import { insertRow } from "../lib/insert-row"
import { parseDuration } from "../lib/parse-duration"
import { sweepExpired } from "../lib/sweep-expired"
import { IDENTITY_TTL } from "./identity"
import type { CodeIdentifier } from "./resolve-code-identifier"

/**
 * How long a verification code is valid.
 *
 * Not configurable: ten minutes is long enough to switch to an email client and
 * short enough that a guessed code has to be guessed while its requester is
 * still waiting. A knob here would only ever be turned the wrong way.
 */
export const VERIFICATION_CODE_TTL = "10m"

/** The condition a code still within its lifetime satisfies. */
export function liveCode() {
  return {
    createdAt: {
      gt: new Date(Date.now() - parseDuration(VERIFICATION_CODE_TTL))
    }
  }
}

/** What sending a code needs to know. */
export interface SendVerificationCodeInput {
  /** Where the code is delivered. */
  deliverTo: CodeIdentifier
  /**
   * What the code is filed under, and what a verify has to name to find it.
   * The address for a sign-in; the session id for an action a signed-in
   * user is confirming, so no other session of theirs can redeem it.
   */
  key: string
  purpose: VerificationPurpose
  locale: string
  headers: Headers
}

/**
 * Generates, stores, and delivers a verification code.
 *
 * The code is stored under scrypt, never in plain text and never as a fast
 * hash: a short code has few enough values that a digest is reversible from a
 * database read, and a slow one keeps a leaked table unreadable for longer
 * than its codes live.
 *
 * Every send is its own attempt: a fresh token goes back to the caller, and
 * the code can only be redeemed by whoever presents it. Nothing is deleted on
 * send, so a stranger requesting a code for your address cannot replace or
 * spend the one you are holding. Sends are limited per address, as the
 * author's app limits mail: five, then one every half hour, whoever asks.
 *
 * @returns The attempt token the caller must present with the code.
 * @throws {AuthApiError} `rateLimited` when the address has had its sends.
 */
export async function sendVerificationCode(
  internals: AuthInternals,
  input: SendVerificationCodeInput
) {
  const { config } = internals
  const { deliverTo, key, purpose, locale, headers } = input

  if (config.rateLimit !== false) {
    await checkRateLimit(
      internals,
      `send:${deliverTo.value}`,
      config.rateLimit.sends
    )
  }

  const attempt = randomBytesBase64url(32)
  const code = randomCode(
    config.verificationCode.alphabet,
    config.verificationCode.length
  )
  // A verified identity code outlives an unspent one, so the sweep waits
  // for the longer of the two.
  const swept = sweepExpired(internals, "verifications", {
    updatedAt: {
      lt: new Date(
        Date.now() -
          Math.max(
            parseDuration(VERIFICATION_CODE_TTL),
            parseDuration(IDENTITY_TTL)
          )
      )
    }
  })
  const stored = await insertRow(internals, "verifications", {
    identifier: key,
    codeHash: await scryptHash(code),
    attemptHash: await sha256Hex(attempt),
    purpose
  })
  await swept

  // Stored first, then delivered, and rolled back if delivery throws, so a
  // code nobody received is not left live against its attempt.
  try {
    await deliver(internals, deliverTo, code, locale, purpose, headers)
  } catch (error) {
    await internals.db.delete({
      table: "verifications",
      where: { id: { eq: stored.id } }
    })
    internals.log.error("verification code delivery failed", {
      channel: deliverTo.kind,
      purpose
    })
    throw error
  }
  // Channel and purpose only: the address is personal data and the code is a
  // credential, so neither is ever handed to a log sink.
  internals.log.info("verification code sent", {
    channel: deliverTo.kind,
    purpose
  })

  return attempt
}

/** Hands the code to the configured sender for its channel. */
async function deliver(
  internals: AuthInternals,
  identifier: CodeIdentifier,
  code: string,
  locale: string,
  purpose: VerificationPurpose,
  headers: Headers
) {
  const { config } = internals

  if (identifier.kind === "email") {
    if (!config.email) throw new AuthApiError("channelNotConfigured")
    await config.email.sendCode({
      email: identifier.value,
      code,
      locale,
      purpose,
      headers
    })
    return
  }

  if (!config.sms) throw new AuthApiError("channelNotConfigured")
  await config.sms.sendCode({
    phoneNumber: identifier.value,
    code,
    locale,
    purpose,
    headers
  })
}
