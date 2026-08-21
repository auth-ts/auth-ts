import type { AuthServerInternals } from "../core/auth-server-internals.ts"
import { AuthApiError } from "../http/auth-api-error.ts"
import { normalizeEmail, normalizePhone } from "../lib/normalize-identifiers.ts"

/**
 * A sign-in identifier after normalization, tagged with the channel it arrived on.
 *
 * Tagged rather than a bare string because the channel decides which sender runs
 * and which limits apply; carrying it alongside the value means no downstream
 * step has to re-derive it by guessing at the format.
 */
export interface CodeIdentifier {
  kind: "email" | "phoneNumber"
  value: string
}

/** The body shape shared by `send-code` and `verify-code`. */
export interface IdentifierBody {
  email?: unknown
  phoneNumber?: unknown
}

/**
 * Turns a request body into exactly one normalized, deliverable identifier.
 *
 * The shape of the body *is* the channel selector, so this is the single place
 * that rule is enforced — for both sending and verifying, which is why it lives
 * here rather than inline in either endpoint.
 *
 * @throws {AuthApiError} `invalidField` unless exactly one identifier is present
 * and well formed, or `channelNotConfigured` when this server has no sender for it.
 */
export function resolveCodeIdentifier(
  internals: AuthServerInternals,
  body: IdentifierBody
): CodeIdentifier {
  const hasEmail =
    typeof body.email === "string" && body.email.trim().length > 0
  const hasPhone =
    typeof body.phoneNumber === "string" && body.phoneNumber.trim().length > 0

  if (hasEmail === hasPhone) {
    throw new AuthApiError("invalidField", 400, {
      message: "Provide exactly one of email or phoneNumber."
    })
  }

  if (hasEmail) {
    if (!internals.options.email)
      throw new AuthApiError("channelNotConfigured", 400)
    const value = normalizeEmail(body.email as string)
    if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value)) {
      throw new AuthApiError("invalidField", 400, {
        message: "Provide a valid email address."
      })
    }
    return { kind: "email", value }
  }

  if (!internals.options.sms)
    throw new AuthApiError("channelNotConfigured", 400)

  try {
    return {
      kind: "phoneNumber",
      value: normalizePhone(body.phoneNumber as string)
    }
  } catch (error) {
    throw new AuthApiError("invalidField", 400, {
      message: (error as Error).message
    })
  }
}
