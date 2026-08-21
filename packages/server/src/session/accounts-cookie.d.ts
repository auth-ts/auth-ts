import type { AuthServerInternals } from "../core/auth-server-internals.ts"
/**
 * How many users may be parked in one browser.
 *
 * Fixed rather than configurable: the real constraint is cookie size, and there
 * is no version of this number a consumer should be tuning.
 */
export declare const PARKED_ACCOUNT_LIMIT = 5
/** Reads the parked refresh tokens, most recently used first. */
export declare function readAccountsCookie(
  internals: AuthServerInternals,
  headers: Headers
): string[]
/** Serializes parked tokens for the accounts cookie. */
export declare function serializeAccounts(tokens: string[]): string
/**
 * Drops parked tokens whose sessions are gone or expired.
 *
 * Called wherever the list is read, so a revoked device stops appearing in the
 * account switcher on the next request rather than lingering until someone
 * clicks it.
 */
export declare function pruneDeadAccounts(
  internals: AuthServerInternals,
  tokens: string[]
): Promise<string[]>
/**
 * Adds the outgoing active token to the parked list, evicting the oldest if full.
 *
 * Eviction is a real sign-out, not just a forget: the evicted session row is
 * deleted, so a token that is no longer reachable from this browser cannot be
 * replayed from anywhere else either.
 *
 * @returns The new parked list, oldest last.
 */
export declare function demoteActive(
  internals: AuthServerInternals,
  parked: string[],
  activeToken: string
): Promise<string[]>
/** Removes a token from the parked list — used when it becomes the active one. */
export declare function promoteAccount(
  parked: string[],
  token: string
): string[]
//# sourceMappingURL=accounts-cookie.d.ts.map
