import type { JWK } from "jose"

/** A JWKS document — the shape `public/jwks.json` has, and the one verification reads. */
export interface Jwks {
  keys: JWK[]
}

/**
 * Builds the key set local verification reads: the signing key's public half,
 * then any additional public keys.
 *
 * It mirrors what a consumer publishes in `jwks.json`, so the in-process
 * `verifyToken` follows the same rotation runbook a remote verifier does.
 * Thumbprint `kid`s are what make that a non-event: publish the new key
 * alongside the old, wait out the access-token lifetime plus the verifier's
 * cache so everyone holds both, switch signing to the new key, wait once more
 * so nothing in flight was signed by the old one, then remove it.
 */
export function buildJwks(
  signingPublicJwk: JWK,
  additionalPublicJwks: JWK[] = []
): Jwks {
  return { keys: [signingPublicJwk, ...additionalPublicJwks] }
}
