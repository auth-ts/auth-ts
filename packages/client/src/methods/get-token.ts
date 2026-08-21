import type { AuthUser } from "@auth-ts/server"
import type { AuthClientInternals } from "../core/auth-client-internals.ts"
import { AuthError } from "../lib/auth-error.ts"

/** What the refresh endpoint returns. */
interface TokenResponse {
  accessToken: string
  user: AuthUser
}

/** Decodes a token's `iat` and `exp` without verifying it — the browser cannot verify anyway. */
function readLifetimeClaims(token: string) {
  try {
    const payload = token.split(".")[1]
    if (!payload) return {}

    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as {
      iat?: number
      exp?: number
    }
  } catch {
    return {}
  }
}

/**
 * Returns a usable access token, refreshing only when necessary.
 *
 * This is the data-plane workhorse: hand it to a PostgREST client as its
 * `accessToken` callback and it will return the cached token until shortly
 * before expiry, then transparently exchange the refresh cookie for a new one.
 *
 * Concurrent callers share a single request, so a page that mounts ten
 * components makes one round-trip and they all see the same token.
 *
 * @throws {AuthError} `unauthenticated` when there is no live session. Local
 * state is cleared first, because a token and a user that outlive their session
 * are worse than none.
 */
export function createGetToken(internals: AuthClientInternals) {
  return async function getToken(): Promise<string> {
    const cached = internals.tokenStore.get()
    if (cached && !internals.tokenStore.isExpiringSoon()) return cached.token

    return internals.tokenStore.singleFlight(async () => {
      // Re-check inside the lock: a queued caller may be waiting on a refresh
      // that has already completed.
      const current = internals.tokenStore.get()
      if (current && !internals.tokenStore.isExpiringSoon())
        return current.token

      internals.log.debug("refreshing access token")

      try {
        const result = await internals.fetchJson<TokenResponse>({
          method: "POST",
          path: "/token"
        })
        internals.tokenStore.set(
          result.accessToken,
          readLifetimeClaims(result.accessToken)
        )
        internals.userStore.set(result.user)

        return result.accessToken
      } catch (error) {
        if (error instanceof AuthError) {
          internals.log.debug("refresh refused, clearing local state", {
            code: error.code
          })
          internals.tokenStore.clear()
          internals.userStore.set(null)
        }

        throw error
      }
    })
  }
}
