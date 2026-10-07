import type { TokenResult } from "../../endpoints/token"
import type { AuthClientInternals } from "../core/auth-client-internals"
import { AuthError } from "../lib/auth-error"
import { decodeToken } from "../lib/decode-token"
import { reviveUser } from "../lib/revive-user"
import { mayHaveSession } from "../lib/session-hint"

/** A token refresh, and the three ways of asking for its result. */
export interface RefreshToken {
  /** Renews through the selected session transport. */
  refresh: () => Promise<TokenResult | null>
  /** A usable token, or `null` when nobody is signed in. */
  getToken: (options?: GetTokenOptions) => Promise<string | null>
  /** A usable token, or the server's own `unauthenticated` error. */
  requireToken: () => Promise<string>
}

/** Per-call options for {@link RefreshToken.getToken}. */
export interface GetTokenOptions {
  /** Called with the token and its user when this call fetched a new token. */
  onRefresh?: (result: TokenResult) => void
}

/** Builds the token refresh and the cached read over it. */
export function createGetToken(internals: AuthClientInternals): RefreshToken {
  const accepted = new WeakMap<TokenResult, number>()
  const refresh = (): Promise<TokenResult | null> =>
    internals.tokenStore.singleFlight(async () => {
      if (!internals.sessionStore && !mayHaveSession(internals.config)) {
        internals.tokenStore.clear()
        return null
      }
      const started = internals.tokenStore.version()
      const stored = await internals.sessionStore?.read()
      const userId = stored?.active
      const credential = userId && stored?.accounts[userId]
      if (internals.sessionStore && !credential) {
        if (internals.tokenStore.version() === started)
          internals.tokenStore.clear()
        return null
      }
      try {
        const wire = await internals.fetchJson<TokenResult | null>({
          method: "POST",
          path: "/token",
          body: {},
          ...(credential ? { bearer: credential } : {})
        })
        const result = wire && { ...wire, user: reviveUser(wire.user) }
        const current = await internals.sessionStore?.read()
        if (
          internals.tokenStore.version() !== started ||
          (current &&
            (current.active !== userId ||
              current.accounts[userId ?? ""] !== credential))
        )
          return null
        if (result && credential && result.user.id !== userId) {
          internals.tokenStore.invalidate()
          internals.tokenStore.clear()
          if (userId) await internals.sessionStore?.remove(userId, credential)
          return null
        }
        if (result) {
          if (
            userId &&
            credential &&
            result.multiUser !== undefined &&
            result.multiUser !== stored?.multiUser
          ) {
            const committed = await internals.sessionStore?.put(
              userId,
              credential,
              result.multiUser,
              (data) =>
                internals.tokenStore.version() === started &&
                data.active === userId &&
                data.accounts[userId] === credential
            )
            if (!committed) return null
          }
          if (internals.tokenStore.version() !== started) return null
          internals.tokenStore.set(result.token)
          accepted.set(result, internals.tokenStore.version())
        } else {
          if (internals.sessionStore) internals.tokenStore.invalidate()
          internals.tokenStore.clear()
          if (userId && credential)
            await internals.sessionStore?.remove(userId, credential)
        }
        return result
      } catch (error) {
        if (
          error instanceof AuthError &&
          error.code === "unauthenticated" &&
          internals.tokenStore.version() === started
        ) {
          const current = await internals.sessionStore?.read()
          if (
            internals.tokenStore.version() === started &&
            (!current ||
              (current.active === userId &&
                current.accounts[userId ?? ""] === credential))
          ) {
            if (internals.sessionStore) internals.tokenStore.invalidate()
            internals.tokenStore.clear()
            if (userId && credential)
              await internals.sessionStore?.remove(userId, credential)
          }
        }
        throw error
      }
    })

  const requireToken = async (options?: GetTokenOptions) => {
    if (internals.sessionStore) {
      const stored = await internals.sessionStore.read()
      const held = internals.tokenStore.get()
      const claims =
        held &&
        internals.config.sessionStorage &&
        decodeToken(held.token)?.claims
      const credential = stored.active && stored.accounts[stored.active]
      if (
        held &&
        (!credential ||
          claims?.sub !== stored.active ||
          claims?.sid !== credential.slice(0, credential.lastIndexOf(".")))
      ) {
        internals.tokenStore.invalidate()
        internals.tokenStore.clear()
      }
    }
    const cached = internals.tokenStore.get()
    if (!cached || internals.tokenStore.mustRefresh()) {
      let result: TokenResult | null
      try {
        result = await refresh()
      } catch (error) {
        const current = internals.tokenStore.get()
        if (
          error instanceof AuthError &&
          error.code === "unauthenticated" &&
          current &&
          !internals.tokenStore.mustRefresh()
        )
          return current.token
        throw error
      }
      if (result && accepted.get(result) !== internals.tokenStore.version())
        result = null
      const held = internals.tokenStore.get()
      if (!result && held && !internals.tokenStore.mustRefresh())
        return held.token
      if (
        !result &&
        internals.sessionStore &&
        (await internals.sessionStore.read()).active
      )
        result = await refresh()
      if (!result) {
        // Built here rather than caught from the server, because a client that
        // never sent the request still owes `requireToken` the same error it
        // would have.
        throw new AuthError("unauthenticated", 401, "You are not signed in.")
      }
      if (accepted.get(result) !== internals.tokenStore.version())
        throw new AuthError(
          "unauthenticated",
          401,
          "The account changed during the request."
        )
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
        .then(
          (result) =>
            result &&
            accepted.get(result) === internals.tokenStore.version() &&
            options?.onRefresh?.(result)
        )
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
