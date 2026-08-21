import type { AuthErrorCode } from "./error-response.ts";
/**
 * The built-in English message for every error code.
 *
 * Complete by construction: the `Record` is not `Partial`, so adding a code to
 * {@link AuthErrorCode} without writing its message is a compile error rather
 * than a blank string discovered in production.
 *
 * The wording rule matches the logging rule — no identifiers, no secrets. A
 * message never echoes back the email or phone number it was given, because
 * error text is the one part of a failed request that reliably reaches a screen,
 * a screenshot, or a support ticket.
 */
export declare const builtInErrorMessages: Record<AuthErrorCode, string>;
/** Consumer message overrides: a partial overlay per locale. */
export type LocaleMessages = Partial<Record<AuthErrorCode, string>>;
/** Server-side message localization. */
export interface LocalizationOptions {
    /** Falls back to this locale when the request matches none. Defaults to `"en"`. */
    defaultLocale?: string;
    /** Per-locale overrides. Partial — anything missing falls through, never blank. */
    messages?: Record<string, LocaleMessages>;
}
/**
 * Resolves the message for a code in a locale.
 *
 * Fallback is per key, not per locale: a German overlay that translates two of
 * thirteen codes yields German for those two and English for the rest, rather
 * than an empty string for the eleven it forgot.
 *
 * `{retryAfter}` is the only interpolation, and it applies to consumer overrides
 * too.
 */
export declare function getErrorMessage(code: AuthErrorCode, locale: string | undefined, localization: LocalizationOptions | undefined, values?: {
    retryAfter?: number;
}): string;
//# sourceMappingURL=get-error-message.d.ts.map