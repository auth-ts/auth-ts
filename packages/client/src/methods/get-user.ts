import type { AuthUser } from "@auth-ts/server"
import type { AuthClientInternals } from "../core/auth-client-internals.ts"
import { AuthError } from "../lib/auth-error.ts"

/**
 * Returns the signed-in user, or `null`.
 *
 * The single user read, and it is gated on the access token rather than on a
 * separate cache: a valid token means the session was live moments ago, so this
 * costs nothing. When the token is missing or stale it refreshes once, and takes
 * the user from that response — the token itself carries only `sub` and is never
 * decoded into a user.
 *
 * A network failure resolves to the last known user rather than `null`. Being
 * offline is not being signed out, and an application that forgets who you are
 * every time the connection drops is worse than one that is briefly optimistic.
 */
export function createGetUser(
  internals: AuthClientInternals,
  getToken: () => Promise<string>
) {
  return async function getUser(): Promise<AuthUser | null> {
    const restored = internals.userStore.restore()

    if (internals.tokenStore.get() && !internals.tokenStore.isExpiringSoon()) {
      return internals.userStore.get()
    }

    try {
      await getToken()
      return internals.userStore.get()
    } catch (error) {
      if (error instanceof AuthError) return null

      internals.log.debug("offline, keeping the last known user")
      return internals.userStore.get() ?? restored
    }
  }
}
