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
 * What a session's lifetime counts from, as the two conditions core asks.
 *
 * `session.ttl` is policy, not a column: sliding sessions live `ttl` past
 * their last hour of use, fixed ones `ttl` past creation, and changing the
 * option changes every session at once.
 */
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
