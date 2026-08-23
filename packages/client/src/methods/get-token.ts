import type { TokenResult } from "@auth-ts/server"
import type { AuthClientInternals } from "../core/auth-client-internals"
import { AuthError } from "../lib/auth-error"
import { reviveUser } from "../lib/revive-user"
import { mayHaveSession } from "../lib/session-hint"

/** A token refresh, and the two ways of asking for its result. */
export interface RefreshToken {
  /** Exchanges the refresh cookie for a token, or `null` when there is no session. */
  refresh: () => Promise<TokenResult | null>
  /** A usable token, or `null` when nobody is signed in. */
  getToken: (options?: GetTokenOptions) => Promise<string | null>
  /** A usable token, or the server's own `unauthenticated` error. */
  requireToken: () => Promise<string>
}

/** Per-call options for {@link RefreshToken.getToken}. */
export interface GetTokenOptions {
  /**
   * Called when this call had to mint, with the token and the user it names.
   *
   * `GET /token` reads that row to mint, so the user arrives with the token and
   * costs nothing extra. Seeding a cache from here is what lets a cold boot
   * render from one request. A call served from memory never fires it: nothing
   * was read, and the user it could report would be as old as the token.
   */
  onRefresh?: (result: TokenResult) => void
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
 *
 * A signed-out browser answers `null` without a request at all — see
 * {@link mayHaveSession} — so a page nobody is signed in to costs nothing on
 * load and nothing again on every tab focus.
 */
export function createGetToken(internals: AuthClientInternals): RefreshToken {
  // Built here rather than caught from the server, because a client that never
  // sent the request still owes `requireToken` the same error it would have.
  const noSession = () =>
    new AuthError("unauthenticated", 401, "You are not signed in.")

  const forget = async () => {
    internals.tokenStore.clear()
    // The refresh cookie is what was just refused, so a jar holding it is
    // holding a dead credential. A browser's own jar is the browser's.
    await internals.cookieJar?.clear()
  }

  const refresh = (): Promise<TokenResult | null> =>
    internals.tokenStore.singleFlight(async () => {
      if (!mayHaveSession(internals.config)) {
        internals.log.debug("no session hint, skipping the refresh")
        // Another tab may have signed out since this one last looked.
        internals.tokenStore.clear()

        return null
      }

      internals.log.debug("refreshing access token")

      try {
        const wire = await internals.fetchJson<TokenResult | null>({
          method: "GET",
          path: "/token"
        })
        const result = wire && { ...wire, user: reviveUser(wire.user) }
        if (!result) {
          internals.log.debug("no session, clearing local state")
          await forget()

          return null
        }
        internals.tokenStore.set(result.token)

        return result
      } catch (error) {
        // Only the server saying "no session" is grounds to forget the user. A
        // 500, a 502 from the proxy, a 429 — every non-2xx becomes an AuthError,
        // and most of them say nothing about whether the cookie is still good.
        if (error instanceof AuthError && error.code === "unauthenticated") {
          internals.log.debug("refresh refused, clearing local state")
          await forget()
        }

        throw error
      }
    })

  const requireToken = async (options?: GetTokenOptions) => {
    const cached = internals.tokenStore.get()
    if (!cached || internals.tokenStore.mustRefresh()) {
      const result = await refresh()
      if (!result) throw noSession()
      options?.onRefresh?.(result)

      return result.token
    }

    if (internals.tokenStore.isExpiringSoon()) {
      // Behind the caller, and deliberately not awaited. A failure here is not
      // this call's to report: the token being returned is still good, and the
      // next call finds the state this one left — cleared, if the session is
      // gone.
      // Concurrent callers share the one refresh, so each of their callbacks
      // sees the same result rather than only the first.
      void refresh()
        .then((result) => result && options?.onRefresh?.(result))
        .catch(() => {})
    }

    return cached.token
  }

  return {
    refresh,
    requireToken,

    getToken: async (options) => {
      try {
        return await requireToken(options)
      } catch (error) {
        if (error instanceof AuthError && error.code === "unauthenticated") {
          return null
        }

        throw error
      }
    }
  }
}
