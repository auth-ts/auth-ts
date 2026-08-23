import type { TokenResult } from "@auth-ts/server"
import type { AuthClientInternals } from "../core/auth-client-internals"
import { AuthError } from "../lib/auth-error"

/** A token refresh, and the two ways of asking for its result. */
export interface RefreshToken {
  /** Exchanges the refresh cookie for a token, deduplicating concurrent calls. */
  refresh: () => Promise<TokenResult>
  /** A usable token, or `null` when nobody is signed in. */
  getToken: () => Promise<string | null>
  /** A usable token, or the server's own `unauthenticated` error. */
  requireToken: () => Promise<string>
}

/**
 * Builds the token refresh and the cached read over it.
 *
 * `getToken` is the data-plane workhorse: hand it to a PostgREST client as its
 * token callback and it will return the cached token until shortly before
 * expiry, then transparently exchange the refresh cookie for a new one.
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
 * `getToken` resolves `null` when there is no live session and `requireToken`
 * throws instead. Nobody signed in is an answer, not a failure, and a caller
 * asking "who is here" should not have to catch to hear it; a caller about to
 * authenticate a request has nothing to do with `null` and wants the error.
 * Every other failure — the server erroring, a proxy answering for it, the
 * network dropping — throws from both, and clears nothing: none of those is a
 * verdict on the session, and blanking the interface because a deploy was
 * mid-flight is the bug, not the fix.
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

  const requireToken = async () => {
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

  return {
    refresh,
    requireToken,

    getToken: async () => {
      try {
        return await requireToken()
      } catch (error) {
        if (error instanceof AuthError && error.code === "unauthenticated") {
          return null
        }

        throw error
      }
    }
  }
}
