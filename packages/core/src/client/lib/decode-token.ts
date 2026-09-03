import type { DecodedToken } from "../../jwt/decode-token"
import type { UnverifiedClaims } from "../../jwt/verify-token"

/**
 * Decodes a token **without verifying its signature**.
 *
 * The browser has no key to verify with and no need for one: what it does with
 * the claims — keep the token until near `exp`, mark which session row is this
 * device by `sid` — is display and bookkeeping, where a wrong answer costs a
 * refresh or a badge on the wrong row and never any authority. The same
 * function on the server carries the same rule. **Never authorize with this.**
 *
 * @returns The claims and whether they have expired, or `null` if the input is
 * not a well-formed JWT.
 */
export function decodeToken(token: string): DecodedToken | null {
  try {
    const payload = token.split(".")[1]
    if (!payload) return null

    const claims = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
    ) as UnverifiedClaims
    const expired =
      typeof claims.exp === "number" && claims.exp * 1000 <= Date.now()

    return { claims, expired }
  } catch {
    return null
  }
}
