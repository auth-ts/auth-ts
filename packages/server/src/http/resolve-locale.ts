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
export function resolveLocale(
  acceptLanguage: string | null | undefined,
  localization?: LocalizationOptions
) {
  const defaultLocale = localization?.defaultLocale ?? "en"
  const configured = Object.keys(localization?.messages ?? {})
  if (!acceptLanguage || configured.length === 0) return defaultLocale

  for (const requested of parseAcceptLanguage(acceptLanguage)) {
    const exact = configured.find(
      (locale) => locale.toLowerCase() === requested
    )
    if (exact) return exact

    const language = requested.split("-")[0]
    const byLanguage = configured.find(
      (locale) => locale.toLowerCase().split("-")[0] === language
    )
    if (byLanguage) return byLanguage
  }

  return defaultLocale
}

/** Returns the requested locales, most preferred first, lowercased. */
function parseAcceptLanguage(acceptLanguage: string) {
  return acceptLanguage
    .split(",")
    .map((entry) => {
      const [tag = "", ...parameters] = entry.trim().split(";")
      const quality = parameters
        .map((parameter) => /^\s*q=([\d.]+)\s*$/.exec(parameter))
        .find((matched) => matched !== null)
      return {
        tag: tag.trim().toLowerCase(),
        quality: quality ? Number(quality[1]) : 1
      }
    })
    .filter((entry) => entry.tag && entry.tag !== "*" && entry.quality > 0)
    .sort((left, right) => right.quality - left.quality)
    .map((entry) => entry.tag)
}
