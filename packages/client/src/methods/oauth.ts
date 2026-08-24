import type { AuthorizeURLResult } from "@auth-ts/server"
import type { AuthClientInternals } from "../core/auth-client-internals"

/** Where to send the browser, and where to come back to. */
export interface OAuthNavigationInput {
  provider: string
  /** Same-origin path to return to after the flow; anything else falls back to `/`. */
  redirect?: string
}

/**
 * Asks the server for a provider's authorize URL and goes there.
 *
 * The server answers with the URL rather than a redirect, because only the
 * caller knows how to navigate: a browser assigns `location`, and a desktop or
 * mobile shell has to open the system browser instead of its own webview. The
 * fetch is what sets the state cookie, so it must land before the navigation.
 */
async function startFlow(
  internals: AuthClientInternals,
  path: string,
  input: OAuthNavigationInput,
  authenticated: boolean
) {
  const { url } = await internals.fetchJson<AuthorizeURLResult>({
    method: "POST",
    path: `${path}/${encodeURIComponent(input.provider)}`,
    body: input.redirect ? { redirect: input.redirect } : {},
    authenticated
  })

  globalThis.location.assign(url)
}

/**
 * Starts an OAuth sign-in, sending the browser to the provider.
 *
 * Resolves only if something goes wrong before the navigation — otherwise the
 * page is on its way out. When the user comes back the session cookie is
 * already set, so the application boots, calls `getUser`, and finds them signed
 * in: the callback hands the SPA no token, and the cookie is what buys the first
 * one.
 *
 * Signing in while already signed in never links accounts. Use `connectProvider` for that.
 */
export function createSignInWithProvider(internals: AuthClientInternals) {
  return function signInWithProvider(
    input: OAuthNavigationInput
  ): Promise<void> {
    return startFlow(internals, "/sign-in/provider", input, false)
  }
}

/** Starts linking a provider to the currently signed-in user. */
export function createConnectProvider(internals: AuthClientInternals) {
  return function connectProvider(input: OAuthNavigationInput): Promise<void> {
    return startFlow(internals, "/identities/connect", input, true)
  }
}
