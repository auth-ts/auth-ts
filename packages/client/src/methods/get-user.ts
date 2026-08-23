import type { AuthClientInternals } from "../core/auth-client-internals"
import { AuthError } from "../lib/auth-error"
import { readLifetimeClaims } from "../lib/read-lifetime-claims"
import type { UserResponse } from "./get-token"

/**
 * Reads the signed-in user, the session, and a token, or `null`.
 *
 * Always goes to the server. There is no cache here on purpose: a name changed
 * in another tab or on another device has to arrive somehow, and deciding when
 * to ask again is the caller's — wrap this in a query library, which already
 * does that, along with persistence and cross-tab behaviour if you want them.
 *
 * `null` means the server said the session is gone, and the stored token is
 * dropped with it. Every other failure throws, because a 502 from a proxy is
 * not a statement about whether anyone is signed in, and swallowing it would
 * make it look like one.
 */
export function createGetUser(internals: AuthClientInternals) {
  return async function getUser(): Promise<UserResponse | null> {
    try {
      // Deliberately not `getToken()` first: this request is what mints one, so
      // asking beforehand would refresh through the endpoint about to be called.
      // The live token rides along automatically and the server answers with a
      // new one only when that one is spent.
      const result = await internals.fetchJson<UserResponse>({
        method: "GET",
        path: "/user"
      })
      if (result.token) {
        internals.tokenStore.set(result.token, readLifetimeClaims(result.token))
      }

      return result
    } catch (error) {
      if (error instanceof AuthError && error.code === "unauthenticated") {
        internals.tokenStore.clear()

        return null
      }

      throw error
    }
  }
}
