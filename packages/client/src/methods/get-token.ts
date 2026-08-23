import type { AuthClientInternals } from "../core/auth-client-internals"
import { AuthError } from "../lib/auth-error"

/**
 * Returns a usable access token, refreshing only when necessary.
 *
 * This is the data-plane workhorse: hand it to a PostgREST client as its
 * `token` callback and it will return the cached token until shortly
 * before expiry, then transparently exchange the refresh cookie for a new one.
 *
 * Only a token too close to expiry to be worth handing out makes a caller wait.
 * Approaching that point the cached token is returned immediately and the
 * refresh runs behind it, so the common case costs no round trip.
 *
 * Concurrent callers share a single request, so a page that mounts ten
 * components makes one round-trip and they all see the same token.
 *
 * @throws {AuthError} `unauthenticated` when there is no live session. Local
 * state is cleared first, because a token and a user that outlive their session
 * are worse than none. Any other failure — the server erroring, a proxy in
 * front of it answering for it, the network dropping — is thrown as-is and
 * clears nothing: none of those is a verdict on the session, and blanking the
 * interface because a deploy was mid-flight is the bug, not the fix.
 */
export function createGetToken(internals: AuthClientInternals) {
  const refresh = (): Promise<string> =>
    internals.tokenStore.singleFlight(async () => {
      // Re-check inside the lock: a queued caller may be waiting on a refresh
      // that has already completed.
      const current = internals.tokenStore.get()
      if (current && !internals.tokenStore.isExpiringSoon())
        return current.token

      internals.log.debug("refreshing access token")

      try {
        // Through the user read, not the session read: minting needs the user
        // row for its `type` claim, so this is the one endpoint where that cost
        // is not wasted. The token arrives in the response header and the fetch
        // layer has already stored it.
        await internals.fetchJson<unknown>({ method: "GET", path: "/user" })
        const refreshed = internals.tokenStore.get()
        // No bearer was sent — this path runs only when the held token is
        // spent — so the server always answers with one.
        if (!refreshed) {
          throw new Error("the user read returned no token to refresh with")
        }

        return refreshed.token
      } catch (error) {
        // Only the server saying "no session" is grounds to forget the user. A
        // 500, a 502 from the proxy, a 429 — every non-2xx becomes an AuthError,
        // and most of them say nothing about whether the cookie is still good.
        if (error instanceof AuthError && error.code === "unauthenticated") {
          internals.log.debug("refresh refused, clearing local state")
          internals.tokenStore.clear()
        }

        throw error
      }
    })

  return async function getToken(): Promise<string> {
    const cached = internals.tokenStore.get()
    if (!cached || internals.tokenStore.mustRefresh()) return refresh()

    if (internals.tokenStore.isExpiringSoon()) {
      // Behind the caller, and deliberately not awaited. A failure here is not
      // this call's to report: the token being returned is still good, and the
      // next call finds the state this one left — cleared, if the session is
      // gone.
      void refresh().catch(() => {})
    }

    return cached.token
  }
}
