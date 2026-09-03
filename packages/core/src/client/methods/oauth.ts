import type { AuthorizeURLResult } from "../../endpoints/sign-in/provider/$provider"
import type { AuthClientInternals } from "../core/auth-client-internals"

/** Where to send the browser, and where to come back to. */
export interface OAuthNavigationInput {
  provider: string
  /** Same-origin path to return to after the flow; anything else falls back to `/`. */
  redirect?: string
  /**
   * Same-origin path a failed flow returns to, with the code in `?error=`.
   *
   * Without it the server sends failures to its configured `baseURL`, and
   * answers in JSON when it has none. The success `redirect` is never used for
   * a failure — it is where someone lands once they are signed in.
   */
  errorRedirect?: string
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
    body: {
      ...(input.redirect ? { redirect: input.redirect } : {}),
      ...(input.errorRedirect ? { errorRedirect: input.errorRedirect } : {})
    },
    authenticated
  })

  globalThis.location.assign(url)
}

/** Builds `signInWithProvider`. */
export function createSignInWithProvider(internals: AuthClientInternals) {
  return function signInWithProvider(
    input: OAuthNavigationInput
  ): Promise<void> {
    return startFlow(internals, "/sign-in/provider", input, false)
  }
}

/** Builds `connectProvider`. */
export function createConnectProvider(internals: AuthClientInternals) {
  return function connectProvider(input: OAuthNavigationInput): Promise<void> {
    return startFlow(internals, "/identities/connect", input, true)
  }
}
