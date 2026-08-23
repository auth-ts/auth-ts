import type { TokenResult } from "@auth-ts/server"
import type { AuthClientInternals } from "../core/auth-client-internals"
import { AuthError } from "../lib/auth-error"

/** A token refresh, and the user it was minted for. */
export interface RefreshToken {
  /** Exchanges the refresh cookie for a token, deduplicating concurrent calls. */
  refresh: () => Promise<TokenResult>
  /** A usable token, from cache when there is one. */
  getToken: () => Promise<string>
}

/**
 * Builds the token refresh and the cached read over it.
 *
 * `getToken` is the data-plane workhorse: hand it to a PostgREST client as its
 * `token` callback and it will return the cached token until shortly before
 * expiry, then transparently exchange the refresh cookie for a new one. It is
 * also what every authenticated client method calls first, because the server
 * authenticates from the token and nothing else.
 *
 * Only a token too close to expiry to be worth handing out makes a caller wait.
 * Approaching that point the cached token is returned immediately and the
 * refresh runs behind it, so the common case costs no round trip.
 *
 * Concurrent callers share a single request, so a page that mounts ten
 * components makes one round-trip and they all see the same token.
 *
 * `refresh` returns the user as well, because `GET /token` reads that row to
 * mint and returns it — which is what lets a cold `getUser` cost one request
 * rather than two.
 *
 * @throws {AuthError} `unauthenticated` when there is no live session. Local
 * state is cleared first, because a token and a user that outlive their session
 * are worse than none. Any other failure — the server erroring, a proxy in
 * front of it answering for it, the network dropping — is thrown as-is and
 * clears nothing: none of those is a verdict on the session, and blanking the
 * interface because a deploy was mid-flight is the bug, not the fix.
 */
export function createGetToken(internals: AuthClientInternals): RefreshToken {
  const refresh = (): Promise<TokenResult> =>
    internals.tokenStore.singleFlight(async () => {
      internals.log.debug("refreshing access token")

      try {
        const result = await internals.fetchJson<TokenResult>({
          method: "GET",
          path: "/token"
        })
        internals.tokenStore.set(result.token)

        return result
      } catch (error) {
        // Only the server saying "no session" is grounds to forget the user. A
        // 500, a 502 from the proxy, a 429 — every non-2xx becomes an AuthError,
        // and most of them say nothing about whether the cookie is still good.
        if (error instanceof AuthError && error.code === "unauthenticated") {
          internals.log.debug("refresh refused, clearing local state")
          internals.tokenStore.clear()
          // The refresh cookie is what was just refused, so a jar holding it is
          // holding a dead credential. A browser's own jar is the browser's.
          await internals.cookieJar?.clear()
        }

        throw error
      }
    })

  return {
    refresh,

    getToken: async () => {
      const cached = internals.tokenStore.get()
      if (!cached || internals.tokenStore.mustRefresh()) {
        return (await refresh()).token
      }

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
}
