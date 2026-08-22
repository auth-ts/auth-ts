import type { JWK } from "jose"

/** The JWKS document served at `<basePath>/jwks.json`. */
export interface Jwks {
  keys: JWK[]
}

/**
 * Builds the JWKS document.
 *
 * The current signing key comes first, followed by any additional public keys.
 * Together with thumbprint `kid`s, that is what makes rotation a non-event:
 * publish the new key alongside the old, wait out the access-token lifetime
 * plus the verifier's cache so everyone holds both, switch signing to the new
 * key, wait once more so nothing in flight was signed by the old one, then
 * remove it.
 */
export function buildJwks(
  signingPublicJwk: JWK,
  additionalPublicJwks: JWK[] = []
): Jwks {
  return { keys: [signingPublicJwk, ...additionalPublicJwks] }
}
