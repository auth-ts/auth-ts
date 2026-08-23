import type { ProviderCredentials } from "../../core/auth-server-options"

/**
 * The scopes to ask for: what sign-in needs, plus whatever the deployment added.
 *
 * Deduplicated, because a configured scope that repeats a baseline one is the
 * obvious mistake and some providers echo the duplicate straight back into the
 * granted `scope`.
 */
export function requestedScopes(
  credentials: ProviderCredentials,
  baseline: string[]
) {
  return [...new Set([...baseline, ...(credentials.scopes ?? [])])].join(" ")
}

/** Turns a provider's `expires_in` seconds into the instant it names. */
export function expiresAt(seconds: number) {
  return new Date(Date.now() + seconds * 1000)
}
