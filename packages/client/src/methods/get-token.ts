import type { TokenResult } from "@auth-ts/server"
import type { AuthClientInternals } from "../core/auth-client-internals"
import { AuthError } from "../lib/auth-error"
import { reviveUser } from "../lib/revive-user"
import { mayHaveSession } from "../lib/session-hint"

/** A token refresh, and the three ways of asking for its result. */
export interface RefreshToken {
  /** Exchanges the refresh cookie for a token and its user, or `null` when there is no session. */
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

/** Builds the token refresh and the cached read over it. */
export function createGetToken(internals: AuthClientInternals): RefreshToken {
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
      if (!result) {
        // Built here rather than caught from the server, because a client that
        // never sent the request still owes `requireToken` the same error it
        // would have.
        throw new AuthError("unauthenticated", 401, "You are not signed in.")
      }
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

  /** Maps the server's "no session" onto the `null` both public reads answer with. */
  const orNull = async <Result>(read: () => Promise<Result | null>) => {
    try {
      return await read()
    } catch (error) {
      if (error instanceof AuthError && error.code === "unauthenticated") {
        return null
      }

      throw error
    }
  }

  return {
    // Published, so it answers `null` rather than throwing. `requireToken`
    // keeps the throwing one, which is what carries the server's own error.
    refresh: () => orNull(refresh),
    requireToken,
    getToken: (options) => orNull(() => requireToken(options))
  }
}
