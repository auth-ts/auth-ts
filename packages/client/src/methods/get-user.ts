import type { AuthUser } from "@auth-ts/server"
import type { AuthClientInternals } from "../core/auth-client-internals"
import { AuthError } from "../lib/auth-error"

/**
 * Returns the signed-in user, or `null`.
 *
 * Always reads the server. The stored mirror is a render hint for the first
 * paint and for being offline, not an answer: a name or avatar changed in
 * another tab, on another device, or by something other than this client would
 * otherwise never arrive. The token is ensured first — refreshed if stale — and
 * carries only `sub`, so it is never decoded into a user.
 *
 * Only the server answering `unauthenticated` is a verdict of `null`. Anything
 * else — the network failing, the server erroring, a proxy answering for it —
 * resolves to the last known user, which is `null` only on a device that has
 * never signed in. Being offline is not being signed out, and
 * neither is the auth server being mid-deploy; an application that forgets who
 * you are whenever something between it and the server hiccups is worse than
 * one that is briefly optimistic. Server failures are logged at `warn` so they
 * are not mistaken for a tunnel.
 */
export function createGetUser(
  internals: AuthClientInternals,
  getToken: () => Promise<string>
) {
  return async function getUser(): Promise<AuthUser | null> {
    const restored = internals.userStore.restore()

    try {
      await getToken()
      const { user } = await internals.fetchJson<{ user: AuthUser }>({
        method: "GET",
        path: "/user"
      })
      internals.userStore.set(user)

      return user
    } catch (error) {
      if (error instanceof AuthError) {
        if (error.code === "unauthenticated") return null
        internals.log.warn("auth server failed, keeping the last known user", {
          code: error.code,
          status: error.status
        })
      } else {
        internals.log.debug("offline, keeping the last known user")
      }

      return internals.userStore.get() ?? restored
    }
  }
}
