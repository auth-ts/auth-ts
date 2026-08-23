import type { AuthUser } from "@auth-ts/server"
import type { AuthClientInternals } from "../core/auth-client-internals"
import { AuthError } from "../lib/auth-error"

/**
 * Reads the signed-in user, or `null`.
 *
 * Always goes to the server. There is no cache here on purpose: a name changed
 * in another tab or on another device has to arrive somehow, and deciding when
 * to ask again is the caller's — wrap this in a query library, which already
 * does that, along with persistence if you want it.
 *
 * Any token this request needed was minted on the way and read off the response
 * header, so it doubles as a refresh without having to say so.
 *
 * `null` means the server said the session is gone, and the stored token is
 * dropped with it. Every other failure throws, because a 502 from a proxy is
 * not a statement about whether anyone is signed in.
 */
export function createGetUser(internals: AuthClientInternals) {
  return async function getUser(): Promise<AuthUser | null> {
    try {
      return await internals.fetchJson<AuthUser>({
        method: "GET",
        path: "/user"
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
