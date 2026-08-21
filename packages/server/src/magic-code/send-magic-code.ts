import type { MagicCodePurpose } from "../core/auth-db.ts"
import type { AuthServerInternals } from "../core/auth-server-internals.ts"
import { AuthApiError } from "../http/auth-api-error.ts"
import { checkRateLimit } from "../http/check-rate-limit.ts"
import { getCooldownRemaining } from "../http/get-cooldown-remaining.ts"
import { randomSixDigitCode } from "../lib/generate-random.ts"
import { getClientIp } from "../lib/get-client-ip.ts"
import { hmacSha256Hex } from "../lib/hash.ts"
import { parseDuration } from "../lib/parse-duration.ts"
import type { CodeIdentifier } from "./resolve-code-identifier.ts"

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
  const { options } = internals
  const { identifier, purpose, locale, headers } = input

  if (options.rateLimit !== false) {
    const live = await internals.db.getMagicCode({
      identifier: identifier.value
    })
    const cooldownRemaining = getCooldownRemaining(
      live,
      MAGIC_CODE_TTL,
      options.rateLimit.sendCodeCooldown
    )
    if (cooldownRemaining > 0) {
      throw new AuthApiError("cooldown", 429, { retryAfter: cooldownRemaining })
    }

    const perIdentifier =
      purpose === "deleteUser"
        ? options.rateLimit.deleteUserPerIdentifier
        : options.rateLimit.sendCodePerIdentifier
    const scope = purpose === "deleteUser" ? "deleteUser" : "sendCode"
    await checkRateLimit(
      internals,
      `${scope}:id:${identifier.value}`,
      perIdentifier
    )

    const clientIp = getClientIp(headers)
    if (clientIp)
      await checkRateLimit(
        internals,
        `sendCode:ip:${clientIp}`,
        options.rateLimit.sendCodePerIP
      )
  }

  const code = randomSixDigitCode()
  await internals.db.upsertMagicCode({
    identifier: identifier.value,
    codeHash: await hmacSha256Hex(code, options.secret),
    expiresAt: new Date(Date.now() + parseDuration(MAGIC_CODE_TTL)),
    attempts: 0,
    purpose
  })

  await deliver(internals, identifier, code, locale, purpose, headers)
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
  const { options } = internals

  if (identifier.kind === "email") {
    if (!options.email) throw new AuthApiError("channelNotConfigured", 400)
    await options.email.sendCode({
      email: identifier.value,
      code,
      locale,
      purpose,
      headers
    })
    return
  }

  if (!options.sms) throw new AuthApiError("channelNotConfigured", 400)
  await options.sms.sendCode({
    phoneNumber: identifier.value,
    code,
    locale,
    purpose,
    headers
  })
}
