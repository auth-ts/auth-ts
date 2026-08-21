/**
 * Normalizes an email address: trimmed and lowercased.
 *
 * Every database callback receives the normalized form, so `Ada@Example.com` and
 * `ada@example.com` resolve to one account instead of silently becoming two.
 */
export declare function normalizeEmail(email: string): string
/**
 * Normalizes a phone number to bare E.164: a leading `+` and digits.
 *
 * Spaces, dashes, dots, and brackets are stripped. Country inference is out of
 * scope — an input without `+` is rejected rather than guessed at, because
 * guessing a country code silently sends someone else's code to a stranger.
 *
 * @throws {TypeError} If the result is not `+` followed by 6–15 digits.
 */
export declare function normalizePhone(phoneNumber: string): string
/** Returns `true` when the string looks like an email address. */
export declare function looksLikeEmail(value: string): boolean
//# sourceMappingURL=normalize-identifiers.d.ts.map
