import type { VerificationCodeAction } from "../core/auth-db"
import type { AuthServerInternals } from "../core/auth-server-internals"
import { AuthApiError } from "../http/auth-api-error"
import { checkRateLimit, ipRateLimitKey } from "../http/check-rate-limit"
import { getCooldownRemaining } from "../http/get-cooldown-remaining"
import { randomSixDigitCode } from "../lib/generate-random"
import { hmacSha256Hex } from "../lib/hash"
import { insertRow } from "../lib/insert-row"
import { parseDuration } from "../lib/parse-duration"
import { selectOne } from "../lib/select-one"
import { sweepExpired } from "../lib/sweep-expired"
import type { CodeIdentifier } from "./resolve-code-identifier"

/**
 * How long a verification code is valid.
 *
 * Not configurable: ten minutes is long enough to switch to an email client and
 * short enough that the five-attempt cap and this window together make guessing a
 * six-digit code hopeless. A knob here would only ever be turned the wrong way.
 */
export const VERIFICATION_CODE_TTL = "10m"

/** What sending a code needs to know. */
export interface SendVerificationCodeInput {
  identifier: CodeIdentifier
  action: VerificationCodeAction
  locale: string
  headers: Headers
}

/**
 * Generates, stores, and delivers a verification code.
 *
 * The code is stored as an HMAC keyed with the server secret, never in plain
 * text and never as a bare hash: six digits is a million possibilities, so an
 * unkeyed digest is reversible from a database read in about a second.
 *
 * Storing it also deletes any previous code for that identifier, which is what
 * stops a resend from widening the set of values an attacker may guess.
 *
 * @throws {AuthApiError} `cooldown` or `rateLimited` when throttled.
 */
export async function sendVerificationCode(
  internals: AuthServerInternals,
  input: SendVerificationCodeInput
) {
  const { config } = internals
  const { identifier, action, locale, headers } = input

  if (config.rateLimit !== false) {
    const live = await selectOne(
      internals,
      "verificationCodes",
      { identifier: identifier.value },
      { expiresAt: "desc" }
    )
    const cooldownRemaining = getCooldownRemaining(
      live,
      VERIFICATION_CODE_TTL,
      config.rateLimit.sendCodeCooldown
    )
    if (cooldownRemaining > 0) {
      throw new AuthApiError("cooldown", 429, { retryAfter: cooldownRemaining })
    }

    const perIdentifier =
      action === "deleteUser"
        ? config.rateLimit.deleteUserPerIdentifier
        : config.rateLimit.sendCodePerIdentifier
    const scope = action === "deleteUser" ? "deleteUser" : "sendCode"
    await checkRateLimit(
      internals,
      `${scope}:id:${identifier.value}`,
      perIdentifier
    )

    const ipKey = ipRateLimitKey(internals, headers, "sendCode")
    if (ipKey)
      await checkRateLimit(internals, ipKey, config.rateLimit.sendCodePerIP)
  }

  const code = randomSixDigitCode()
  const codeHash = await hmacSha256Hex(code, config.secret)
  // Delete then insert: latest wins. Two sends racing can leave both rows for
  // an instant, and that is harmless — verification reads the newest, so the
  // earlier code is dead either way and the sweep collects it.
  const swept = sweepExpired(internals, "verificationCodes")
  await internals.db.delete({
    table: "verificationCodes",
    where: { identifier: identifier.value }
  })
  await insertRow(internals, "verificationCodes", {
    identifier: identifier.value,
    codeHash,
    expiresAt: new Date(Date.now() + parseDuration(VERIFICATION_CODE_TTL)),
    action
  })
  await swept

  // Stored first, then delivered, and rolled back if delivery throws. The
  // rollback keeps a sender outage from costing the user anything: the cooldown
  // is derived from the newest stored code, so a row left behind by a code
  // nobody received would refuse their retry for a minute. The delete matches
  // on the hash, so a resend that landed in between keeps its own fresh code.
  //
  // Two sends to one identifier racing each other are not serialized, and do
  // not need to be. Latest wins on verification, so the earlier send's code is
  // dead the moment the later one is stored — whether or not the earlier one is
  // still in flight to the inbox. Serializing that would take a lock primitive
  // the database contract deliberately does not have.
  try {
    await deliver(internals, identifier, code, locale, action, headers)
  } catch (error) {
    await internals.db.delete({
      table: "verificationCodes",
      where: { identifier: identifier.value, codeHash }
    })
    internals.log.error("verification code delivery failed", {
      channel: identifier.kind,
      action
    })
    throw error
  }
  // Channel and action only: the address is personal data and the code is a
  // credential, so neither is ever handed to a log sink.
  internals.log.info("verification code sent", {
    channel: identifier.kind,
    action
  })
}

/** Hands the code to the configured sender for its channel. */
async function deliver(
  internals: AuthServerInternals,
  identifier: CodeIdentifier,
  code: string,
  locale: string,
  action: VerificationCodeAction,
  headers: Headers
) {
  const { config } = internals

  if (identifier.kind === "email") {
    if (!config.email) throw new AuthApiError("channelNotConfigured", 400)
    await config.email.sendCode({
      email: identifier.value,
      code,
      locale,
      action,
      headers
    })
    return
  }

  if (!config.sms) throw new AuthApiError("channelNotConfigured", 400)
  await config.sms.sendCode({
    phoneNumber: identifier.value,
    code,
    locale,
    action,
    headers
  })
}
