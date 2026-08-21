import type { AuthServerInternals } from "../core/auth-server-internals.ts"
import { sha256Hex } from "../lib/hash.ts"
import { readCookie } from "../lib/parse-cookies.ts"

/**
 * How many users may be parked in one browser.
 *
 * Fixed rather than configurable: the real constraint is cookie size, and there
 * is no version of this number a consumer should be tuning.
 */
export const PARKED_ACCOUNT_LIMIT = 5

/** Reads the parked refresh tokens, most recently used first. */
export function readAccountsCookie(
  internals: AuthServerInternals,
  headers: Headers
) {
  const raw = readCookie(headers, internals.options.cookie.accountsName)
  if (!raw) return []

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is string => typeof entry === "string")
  } catch {
    // A corrupted cookie means "no parked accounts", never a failed request.
    internals.log.debug("discarding unparseable accounts cookie")
    return []
  }
}

/** Serializes parked tokens for the accounts cookie. */
export function serializeAccounts(tokens: string[]) {
  return JSON.stringify(tokens)
}

/**
 * Drops parked tokens whose sessions are gone or expired.
 *
 * Called wherever the list is read, so a revoked device stops appearing in the
 * account switcher on the next request rather than lingering until someone
 * clicks it.
 */
export async function pruneDeadAccounts(
  internals: AuthServerInternals,
  tokens: string[]
) {
  const live: string[] = []

  for (const token of tokens) {
    const session = await internals.db.getSession({
      tokenHash: await sha256Hex(token)
    })
    if (session && session.expiresAt.getTime() > Date.now()) live.push(token)
  }

  return live
}

/**
 * Adds the outgoing active token to the parked list, evicting the oldest if full.
 *
 * Eviction is a real sign-out, not just a forget: the evicted session row is
 * deleted, so a token that is no longer reachable from this browser cannot be
 * replayed from anywhere else either.
 *
 * @returns The new parked list, oldest last.
 */
export async function demoteActive(
  internals: AuthServerInternals,
  parked: string[],
  activeToken: string
) {
  const withoutActive = parked.filter((token) => token !== activeToken)
  const next = [activeToken, ...withoutActive]

  while (next.length > PARKED_ACCOUNT_LIMIT) {
    const evicted = next.pop()
    if (!evicted) break
    await internals.db.deleteSession({ tokenHash: await sha256Hex(evicted) })
    internals.log.debug("evicted the oldest parked account")
  }

  return next
}

/** Removes a token from the parked list — used when it becomes the active one. */
export function promoteAccount(parked: string[], token: string) {
  return parked.filter((parkedToken) => parkedToken !== token)
}
