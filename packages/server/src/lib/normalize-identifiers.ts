/**
 * Normalizes an email address: trimmed and lowercased.
 *
 * Every database query uses the normalized form, so `Ada@Example.com` and
 * `ada@example.com` resolve to one account instead of silently becoming two.
 */
export function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

/**
 * Normalizes a phone number to bare E.164: a leading `+` and digits.
 *
 * Spaces, dashes, dots, and brackets are stripped. Country inference is out of
 * scope — an input without `+` is rejected rather than guessed at, because
 * guessing a country code silently sends someone else's code to a stranger.
 *
 * @throws {TypeError} If the result is not `+` followed by 6–15 digits.
 */
export function normalizePhone(phoneNumber: string) {
  const stripped = phoneNumber.replace(/[\s\-().]/g, "")
  if (!/^\+\d{6,15}$/.test(stripped)) {
    throw new TypeError(
      "Phone numbers must be E.164 — a leading + and 6 to 15 digits, e.g. +15551234567."
    )
  }
  return stripped
}

/** Returns `true` when the string looks like an email address. */
export function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}
