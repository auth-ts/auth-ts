/**
 * Decodes `iat` and `exp` from a token without verifying it.
 *
 * The browser cannot verify a signature it has no key for, and does not need
 * to: these two numbers only tell the token store how long to keep the token
 * before refreshing, and a wrong answer costs one extra round-trip rather than
 * any authority. Anything unreadable decodes to no claims, which the store
 * treats as "already expired".
 */
export function readLifetimeClaims(token: string) {
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
