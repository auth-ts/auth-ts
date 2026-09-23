import type { AuthSession } from "../core/auth-database"
import type { AuthInternals } from "../core/auth-internals"
import { constantTimeEqual, hexToBytes } from "../lib/hash"
import { parseDuration } from "../lib/parse-duration"
import { selectOne } from "../lib/select-one"
import { base64ToBytes } from "../shared/base64url"

// Lucia's auth_session.ts, 0BSD
/** The two halves of a session token: the row's id, and SHA-256 of its secret. */
export interface SessionCredential {
  id: string
  secretHash: Uint8Array
}

/** Splits `id.secret` and hashes the secret; `null` otherwise. */
export async function parseSessionToken(
  authSessionToken: string
): Promise<SessionCredential | null> {
  // Base64 has no dot, so any id works
  const separator = authSessionToken.lastIndexOf(".")
  if (separator === -1) {
    return null
  }
  const authSessionId = authSessionToken.slice(0, separator)
  const encodedAuthSessionSecret = authSessionToken.slice(separator + 1)

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

/** Where-conditions for live and stale sessions under `session.ttl`. */
export function sessionAge(internals: AuthInternals) {
  const { sliding, ttl } = internals.config.session
  const cutoff = new Date(Date.now() - parseDuration(ttl))

  return sliding
    ? {
        live: { updatedAt: { gt: cutoff } },
        stale: { updatedAt: { lt: cutoff } }
      }
    : {
        live: { createdAt: { gt: cutoff } },
        stale: { createdAt: { lt: cutoff } }
      }
}

/** The session a credential names, or `null` on a wrong id or secret. */
export async function findSession(
  internals: AuthInternals,
  { id, secretHash }: SessionCredential,
  { live = true }: { live?: boolean } = {}
): Promise<AuthSession | null> {
  const authSession = await selectOne(internals, "sessions", {
    id: { eq: id },
    ...(live ? sessionAge(internals).live : {})
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
