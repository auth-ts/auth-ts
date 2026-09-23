import type { AuthSession } from "../core/auth-database"
import type { AuthInternals } from "../core/auth-internals"
import { sha256Hex, timingSafeEqualHex } from "../lib/hash"
import { selectOne } from "../lib/select-one"

/** The two halves of a session token: the row's id, and `sha256` of its secret. */
export interface SessionCredential {
  id: string
  secretHash: string
}

/**
 * Splits `id.secret` and hashes the secret.
 *
 * The split is at the last `.`: the secret is base64url and cannot contain
 * one, but an id from `generateId` can. A token with no `.` is read as an id
 * with an empty secret, which no row's hash will ever equal — so a cookie
 * that does not parse still names something to look up and find nothing.
 */
export async function parseSessionToken(
  rawToken: string
): Promise<SessionCredential> {
  const at = rawToken.lastIndexOf(".")
  const id = at === -1 ? rawToken : rawToken.slice(0, at)
  const secret = at === -1 ? "" : rawToken.slice(at + 1)

  return { id, secretHash: await sha256Hex(secret) }
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
  const session = await selectOne(internals, "sessions", {
    id: { eq: id },
    ...(live ? { expiresAt: { gt: new Date() } } : {})
  })
  if (!session || !timingSafeEqualHex(secretHash, session.secretHash)) {
    return null
  }

  return session
}
