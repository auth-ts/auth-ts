import type { MagicCodePurpose } from "../core/auth-db"
import type { AuthServerInternals } from "../core/auth-server-internals"
import { AuthApiError } from "../http/auth-api-error"
import { checkRateLimit } from "../http/check-rate-limit"
import { getCooldownRemaining } from "../http/get-cooldown-remaining"
import { randomSixDigitCode } from "../lib/generate-random"
import { getClientIp } from "../lib/get-client-ip"
import { hmacSha256Hex } from "../lib/hash"
import { parseDuration } from "../lib/parse-duration"
import type { CodeIdentifier } from "./resolve-code-identifier"

/**
 * How long a magic code is valid.
 *
 * Not configurable: ten minutes is long enough to switch to an email client and
 * short enough that the five-attempt cap and this window together make guessing a
 * six-digit code hopeless. A knob here would only ever be turned the wrong way.
 */
export const MAGIC_CODE_TTL = "10m"

/** What sending a code needs to know. */
export interface SendMagicCodeInput {
  identifier: CodeIdentifier
  purpose: MagicCodePurpose
  locale: string
  headers: Headers
}

/**
 * Generates, stores, and delivers a magic code.
 *
 * The code is stored as an HMAC keyed with the server secret, never in plain
 * text and never as a bare hash: six digits is a million possibilities, so an
 * unkeyed digest is reversible from a database read in about a second.
 *
 * Storing it also replaces any live code for that identifier, which is what stops
 * a resend from widening the set of values an attacker may guess.
 *
 * @throws {AuthApiError} `cooldown` or `rateLimited` when throttled.
 */
export async function sendMagicCode(
  internals: AuthServerInternals,
  input: SendMagicCodeInput
) {
  const { config } = internals
  const { identifier, purpose, locale, headers } = input

  if (config.rateLimit !== false) {
    const live = await internals.db.getMagicCode({
      identifier: identifier.value
    })
    const cooldownRemaining = getCooldownRemaining(
      live,
      MAGIC_CODE_TTL,
      config.rateLimit.sendCodeCooldown
    )
    if (cooldownRemaining > 0) {
      throw new AuthApiError("cooldown", 429, { retryAfter: cooldownRemaining })
    }

    const perIdentifier =
      purpose === "deleteUser"
        ? config.rateLimit.deleteUserPerIdentifier
        : config.rateLimit.sendCodePerIdentifier
    const scope = purpose === "deleteUser" ? "deleteUser" : "sendCode"
    await checkRateLimit(
      internals,
      `${scope}:id:${identifier.value}`,
      perIdentifier
    )

    const clientIp = getClientIp(headers, internals.config.clientIp)
    if (clientIp)
      await checkRateLimit(
        internals,
        `sendCode:ip:${clientIp}`,
        config.rateLimit.sendCodePerIP
      )
  }

  const code = randomSixDigitCode()
  const codeHash = await hmacSha256Hex(code, config.secret)
  await internals.db.upsertMagicCode({
    identifier: identifier.value,
    codeHash,
    expiresAt: new Date(Date.now() + parseDuration(MAGIC_CODE_TTL)),
    attempts: 0,
    purpose
  })

  // Stored first, then delivered, and rolled back if delivery throws. The order
  // keeps "one live code per identifier" true at every instant — the row always
  // describes the most recently stored code — and the rollback keeps a sender
  // outage from costing the user anything: the cooldown is derived from the
  // live row, so a row left behind by a code nobody received would refuse
  // their retry for a minute. The delete matches on the hash, so a resend that
  // landed in between keeps its own fresh code.
  //
  // Two sends to one identifier racing each other are not serialized, and do
  // not need to be. One live code per identifier already means the earlier
  // send's code is dead the moment the later one is stored — whether or not
  // the earlier one is still in flight to the inbox. If the later delivery
  // then fails, the rollback leaves no row, and the one thing the person can
  // do — ask again — works at once instead of waiting out a cooldown for a
  // code nobody received. Serializing that would take a lock primitive the
  // database contract deliberately does not have.
  try {
    await deliver(internals, identifier, code, locale, purpose, headers)
  } catch (error) {
    await internals.db.deleteMagicCode({
      identifier: identifier.value,
      codeHash
    })
    internals.log.error("magic code delivery failed", {
      channel: identifier.kind,
      purpose
    })
    throw error
  }
  // Channel and purpose only: the address is personal data and the code is a
  // credential, so neither is ever handed to a log sink.
  internals.log.info("magic code sent", { channel: identifier.kind, purpose })
}

/** Hands the code to the configured sender for its channel. */
async function deliver(
  internals: AuthServerInternals,
  identifier: CodeIdentifier,
  code: string,
  locale: string,
  purpose: MagicCodePurpose,
  headers: Headers
) {
  const { config } = internals

  if (identifier.kind === "email") {
    if (!config.email) throw new AuthApiError("channelNotConfigured", 400)
    await config.email.sendCode({
      email: identifier.value,
      code,
      locale,
      purpose,
      headers
    })
    return
  }

  if (!config.sms) throw new AuthApiError("channelNotConfigured", 400)
  await config.sms.sendCode({
    phoneNumber: identifier.value,
    code,
    locale,
    purpose,
    headers
  })
}
