import type { JWK } from "jose"

/** The JWKS document served at `<basePath>/jwks.json`. */
export interface Jwks {
  keys: JWK[]
}

/**
 * Builds the JWKS document.
 *
 * The current signing key comes first, followed by any additional public keys.
 * That ordering is what makes rotation a non-event: publish the new key
 * alongside the old, wait out the access-token lifetime so nothing in flight was
 * signed by a key you are about to drop, switch signing to the new key, then
 * remove the old one.
 */
export function buildJwks(
  signingPublicJwk: JWK,
  additionalPublicJwks: JWK[] = []
): Jwks {
  return { keys: [signingPublicJwk, ...additionalPublicJwks] }
}
