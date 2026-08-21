import type { AuthErrorCode } from "./error-response.ts"

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
export const builtInErrorMessages: Record<AuthErrorCode, string> = {
  cooldown: "Please wait {retryAfter} seconds before requesting another code.",
  rateLimited: "Too many attempts. Please try again in {retryAfter} seconds.",
  invalidCode: "That code is not valid. Request a new one and try again.",
  codeSent: "For your security, confirm this with the code we just sent you.",
  staleSession: "Please sign in again to continue.",
  unauthenticated: "You are not signed in.",
  lastSignInMethod:
    "This is your only way to sign in, so it cannot be removed.",
  providerConflict: "That account is already connected to a different user.",
  channelNotConfigured: "That sign-in method is not available.",
  invalidField: "Some of the submitted fields are not accepted.",
  notFound: "Not found.",
  methodNotAllowed: "That method is not allowed here.",
  guestCannotReceiveCode:
    "Add an email address or phone number before continuing.",
  providerUnavailable:
    "The sign-in provider did not respond. Please try again.",
  internalError: "Something went wrong."
}

/** Consumer message overrides: a partial overlay per locale. */
export type LocaleMessages = Partial<Record<AuthErrorCode, string>>

/** Server-side message localization. */
export interface LocalizationOptions {
  /** Falls back to this locale when the request matches none. Defaults to `"en"`. */
  defaultLocale?: string
  /** Per-locale overrides. Partial — anything missing falls through, never blank. */
  messages?: Record<string, LocaleMessages>
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
export function getErrorMessage(
  code: AuthErrorCode,
  locale: string | undefined,
  localization: LocalizationOptions | undefined,
  values: { retryAfter?: number } = {}
) {
  const defaultLocale = localization?.defaultLocale ?? "en"
  const template =
    (locale ? localization?.messages?.[locale]?.[code] : undefined) ??
    localization?.messages?.[defaultLocale]?.[code] ??
    builtInErrorMessages[code]

  return values.retryAfter === undefined
    ? template
    : template.replace("{retryAfter}", String(values.retryAfter))
}
