import type { AuthServerInternals } from "../core/auth-server-internals"
import { verifyToken } from "./verify-token"

/**
 * The claims of a live access token the caller sent along, if they sent one.
 *
 * Not a credential here — the refresh cookie is what authenticates the request.
 * This answers a different question: does the caller already hold a token worth
 * keeping, so a new one need not be signed?
 *
 * A token that fails to verify is simply absent. Nothing is refused for it: the
 * only consequence is that a fresh one is minted, which is what would have
 * happened anyway.
 */
export async function presentedToken(
  internals: AuthServerInternals,
  headers: Headers
) {
  const raw = headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!raw) return null

  const { config } = internals
  const { verificationKeys } = await internals.keys()

  return verifyToken(
    {
      keys: verificationKeys,
      algorithm: config.jwt.alg,
      ...(config.issuer ? { issuer: config.issuer } : {}),
      ...(config.jwt.audience ? { audience: config.jwt.audience } : {})
    },
    raw
  )
}
