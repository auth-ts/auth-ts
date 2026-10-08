// The author's email_address.go, MIT
/**
 * Whether an address may be an account identifier, by the book's rules.
 *
 * At most 100 characters; exactly one `@`; a local part of lowercase letters,
 * digits, `.`, `-`, `_` and `+`; a domain of lowercase letters, digits, `.`,
 * `-` and `_` with a dot inside it. Never modified first: an address that is
 * displayed and compared everywhere is treated like a username, and the book
 * says to refuse rather than to quietly lowercase.
 */
export function verifyAccountIdentifierEmailAddressPattern(email: string) {
  if (email.length > 100) {
    return false
  }
  const parts = email.split("@")
  if (parts.length !== 2) {
    return false
  }
  const [localPart = "", domainPart = ""] = parts
  const localPartAllowed = verifyEmailAddressLocalPart(localPart)
  if (!localPartAllowed) {
    return false
  }
  return verifyEmailAddressDomainPart(domainPart)
}

function verifyEmailAddressLocalPart(part: string) {
  if (part.length < 1) {
    return false
  }
  for (const char of part) {
    if (char >= "a" && char <= "z") {
      continue
    }
    if (char >= "0" && char <= "9") {
      continue
    }
    if (char === "." || char === "-" || char === "_" || char === "+") {
      continue
    }
    return false
  }
  return true
}

function verifyEmailAddressDomainPart(part: string) {
  if (part.length < 1) {
    return false
  }
  let periodIncluded = false
  for (const char of part) {
    if (char >= "a" && char <= "z") {
      continue
    }
    if (char >= "0" && char <= "9") {
      continue
    }
    if (char === ".") {
      periodIncluded = true
      continue
    }
    if (char === "-" || char === "_") {
      continue
    }
    return false
  }
  if (!periodIncluded) {
    return false
  }
  if (part.startsWith(".") || part.endsWith(".")) {
    return false
  }
  return true
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
