import type { LocalizationOptions } from "./get-error-message.ts"
/**
 * Picks the locale for a request.
 *
 * Order is the explicit locale (the client's `Accept-Language`, which
 * `authClient.setLocale` replaces, so an app's own setting outranks the
 * browser's), then the configured default. Matching is done on the language
 * subtag too, so `de-AT` finds a `de` overlay.
 *
 * Nothing is stored: locale is resolved per request and never persisted. A saved
 * preference is application data — declare it as an additional field if you want
 * one.
 *
 * @param acceptLanguage - Raw `Accept-Language` header, if any.
 * @param localization - Configured locales and default.
 */
export declare function resolveLocale(
  acceptLanguage: string | null | undefined,
  localization?: LocalizationOptions
): string
//# sourceMappingURL=resolve-locale.d.ts.map
