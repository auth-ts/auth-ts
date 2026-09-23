import type { AuthSession } from "../core/auth-database"
import type { AuthInternals } from "../core/auth-internals"
import { constantTimeEqual, hexToBytes } from "../lib/hash"
import { selectOne } from "../lib/select-one"
import { base64ToBytes } from "../shared/base64url"

// Lucia's auth_session.ts, 0BSD
/** The two halves of a session token: the row's id, and SHA-256 of its secret. */
export interface SessionCredential {
  id: string
  secretHash: Uint8Array
}

/**
 * Splits `id.secret` and hashes the secret.
 *
 * @returns The credential, or `null` for anything that is not `id.base64`.
 */
export async function parseSessionToken(
  authSessionToken: string
): Promise<SessionCredential | null> {
  const tokenParts = authSessionToken.split(".")
  if (tokenParts.length !== 2) {
    return null
  }
  const [authSessionId = "", encodedAuthSessionSecret = ""] = tokenParts

  const authSessionSecret = base64ToBytes(encodedAuthSessionSecret)
  if (!authSessionSecret) {
    return null
  }

  const authSessionSecretHashBuffer = await crypto.subtle.digest(
    "SHA-256",
    authSessionSecret
  )

  return {
    id: authSessionId,
    secretHash: new Uint8Array(authSessionSecretHashBuffer)
  }
}

/**
 * The session a credential names, or `null` when its id or secret is wrong.
 *
 * The row is read by primary key; the secret is what proves the caller may
 * hold it. A wrong secret answers exactly as a missing row does, so a cookie
 * naming somebody else's session id resolves to nothing.
 */
export async function findSession(
  internals: AuthInternals,
  { id, secretHash }: SessionCredential,
  { live = true }: { live?: boolean } = {}
): Promise<AuthSession | null> {
  const authSession = await selectOne(internals, "sessions", {
    id: { eq: id },
    ...(live ? { expiresAt: { gt: new Date() } } : {})
  })
  if (authSession === null) {
    return null
  }

  const secretCorrect = constantTimeEqual(
    secretHash,
    hexToBytes(authSession.secretHash)
  )
  if (!secretCorrect) {
    return null
  }

  return authSession
}
