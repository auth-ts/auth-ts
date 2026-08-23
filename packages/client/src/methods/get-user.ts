import type { AuthUser } from "@auth-ts/server"
import type { AuthClientInternals } from "../core/auth-client-internals"
import { AuthError } from "../lib/auth-error"
import type { RefreshToken } from "./get-token"

/**
 * Reads the signed-in user, or `null`.
 *
 * Always goes to the server. There is no cache here on purpose: a name changed
 * in another tab or on another device has to arrive somehow, and deciding when
 * to ask again is the caller's — wrap this in a query library, which already
 * does that, along with persistence if you want it.
 *
 * With no usable token in memory the user comes off the refresh itself, since
 * `/token` reads that row to mint and returns it. So a cold read — a page load,
 * a fresh tab — costs one request rather than a refresh and then a read.
 *
 * `null` means the server said the session is gone, and the stored token is
 * dropped with it. Every other failure throws, because a 502 from a proxy is
 * not a statement about whether anyone is signed in.
 */
export function createGetUser(
  internals: AuthClientInternals,
  refresh: RefreshToken["refresh"]
) {
  return async function getUser(): Promise<AuthUser | null> {
    try {
      const cached = internals.tokenStore.get()
      if (!cached || internals.tokenStore.mustRefresh()) {
        return (await refresh())?.user ?? null
      }

      return await internals.fetchJson<AuthUser>({
        method: "GET",
        path: "/user",
        authenticated: true
      })
    } catch (error) {
      if (error instanceof AuthError && error.code === "unauthenticated") {
        internals.tokenStore.clear()

        return null
      }

      throw error
    }
  }
}
