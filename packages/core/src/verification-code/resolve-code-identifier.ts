import type { AuthUser } from "../core/auth-database"
import type { AuthInternals } from "../core/auth-internals"
import { AuthApiError } from "../http/auth-api-error"
import {
  normalizePhone,
  verifyAccountIdentifierEmailAddressPattern
} from "../lib/normalize-identifiers"

/**
 * A sign-in identifier as it will be stored, tagged with the channel it arrived on.
 *
 * Tagged rather than a bare string because the channel decides which sender runs
 * and which limits apply; carrying it alongside the value means no downstream
 * step has to re-derive it by guessing at the format.
 */
export interface CodeIdentifier {
  kind: "email" | "phoneNumber"
  value: string
}

/** The body shape shared by `sign-in/send-code` and `sign-in/code`. */
export interface IdentifierBody {
  email?: unknown
  phoneNumber?: unknown
}

/**
 * Turns a request body into exactly one deliverable identifier.
 *
 * The shape of the body *is* the channel selector, so this is the single place
 * that rule is enforced — for both sending and verifying, which is why it lives
 * here rather than inline in either endpoint. An email address is the book's
 * account identifier: checked against its rules and never modified, so what
 * the user typed is what is stored, sent to and shown.
 *
 * @throws {AuthApiError} `invalidField` unless exactly one identifier is present,
 * `invalidEmailAddress` for an address the book's rules refuse, `channelNotConfigured`
 * when this server has no sender for it.
 */
export function resolveCodeIdentifier(
  internals: AuthInternals,
  body: IdentifierBody
): CodeIdentifier {
  const hasEmail = typeof body.email === "string" && body.email.length > 0
  const hasPhone =
    typeof body.phoneNumber === "string" && body.phoneNumber.trim().length > 0

  if (hasEmail === hasPhone) {
    throw new AuthApiError("invalidField", {
      message: "Provide exactly one of email or phoneNumber."
    })
  }

  if (hasEmail) {
    if (!internals.config.email) throw new AuthApiError("channelNotConfigured")
    const value = body.email as string
    if (!verifyAccountIdentifierEmailAddressPattern(value)) {
      throw new AuthApiError("invalidEmailAddress")
    }
    return { kind: "email", value }
  }

  if (!internals.config.sms) throw new AuthApiError("channelNotConfigured")

  try {
    return {
      kind: "phoneNumber",
      value: normalizePhone(body.phoneNumber as string)
    }
  } catch (error) {
    throw new AuthApiError("invalidField", {
      message: (error as Error).message
    })
  }
}

/** The channel a code can reach this user on, or `null` for a guest with neither. */
export function accountIdentifier(
  user: Pick<AuthUser, "email" | "phoneNumber">
): CodeIdentifier | null {
  if (user.email) return { kind: "email", value: user.email }
  if (user.phoneNumber) return { kind: "phoneNumber", value: user.phoneNumber }
  return null
}
