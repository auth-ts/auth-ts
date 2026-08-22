import type { AuthClientInternals } from "../core/auth-client-internals.ts"

/** Where to send the browser, and where to come back to. */
export interface OAuthNavigationInput {
  provider: string
  /** Same-origin path to return to after the flow. Anything else is ignored server-side. */
  redirect?: string
}

/** Builds the URL for an OAuth navigation, carrying redirect and locale. */
function buildURL(
  internals: AuthClientInternals,
  path: string,
  input: OAuthNavigationInput
) {
  const url = new URL(
    `${internals.config.baseURL}${internals.config.basePath}${path}/${encodeURIComponent(input.provider)}`,
    globalThis.location?.href ?? "http://localhost"
  )

  if (input.redirect) url.searchParams.set("redirect", input.redirect)
  // A navigation cannot carry Accept-Language, so the locale rides the URL and
  // the server stores it in the state cookie for the callback's error pages.
  if (internals.locale) url.searchParams.set("locale", internals.locale)

  return url.toString()
}

/**
 * Starts an OAuth sign-in by navigating the browser.
 *
 * Not a fetch: OAuth is a redirect dance that must happen at the top level, and
 * this returns nothing because the page is on its way out. When the user comes
 * back the session cookie is already set, so the application boots, calls
 * `getUser`, and finds them signed in — the callback hands the SPA no token.
 *
 * Signing in while already signed in never links accounts. Use `connect` for that.
 */
export function createSignIn(internals: AuthClientInternals) {
  return function signIn(input: OAuthNavigationInput): void {
    globalThis.location.assign(buildURL(internals, "/sign-in", input))
  }
}

/** Starts linking a provider to the currently signed-in user, by navigating. */
export function createConnect(internals: AuthClientInternals) {
  return function connect(input: OAuthNavigationInput): void {
    globalThis.location.assign(buildURL(internals, "/connect", input))
  }
}
