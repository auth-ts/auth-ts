import type { JWK } from "jose"
import { calculateJwkThumbprint, exportJWK, importPKCS8 } from "jose"

/**
 * The signing algorithm.
 *
 * Both are accepted by Neon and Supabase. RS256 is the default for the widest
 * verifier compatibility; ES256 produces smaller signatures and is one line to
 * switch to. Symmetric algorithms are structurally impossible here — a JWKS
 * endpoint cannot publish an HMAC secret without publishing the ability to forge.
 */
export type JwtAlgorithm = "RS256" | "ES256"

/** An imported signing key: what signs, and what gets published. */
export interface SigningKeyMaterial {
  /** Private key — signs tokens, never leaves the server. */
  signingKey: CryptoKey
  /** Key id, carried in every token header. See {@link toPublicJwk}. */
  kid: string
  /** The public JWK, already carrying `kid`, `alg`, and `use`. */
  publicJwk: JWK
}

/**
 * Strips the private components and stamps the public JWK with its `kid`.
 *
 * The `kid` is the RFC 7638 thumbprint of the key itself, never a configured
 * name. A new key therefore carries a new `kid`, which is what tells a verifier
 * holding a cached `jwks.json` to fetch it again rather than check the new
 * token against the old key it knows by that name. And there is nothing to
 * keep in step between the server and the file: both derive it from the key.
 */
async function toPublicJwk(jwk: JWK, algorithm: JwtAlgorithm): Promise<JWK> {
  const published: JWK =
    jwk.kty === "RSA"
      ? { kty: jwk.kty, n: jwk.n, e: jwk.e }
      : { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }
  const kid = await calculateJwkThumbprint(published)

  return { ...published, alg: algorithm, use: "sig", kid }
}

/**
 * Imports a PKCS#8 private key and derives the public JWK to serve from JWKS.
 *
 * The key is imported as extractable so the public half can be derived from it,
 * which keeps configuration to a single secret — supplying the public key
 * separately would create a way for the two to disagree, and a JWKS that does not
 * match the signing key fails only at the verifier, far from the mistake.
 *
 * @throws {Error} If the PEM cannot be parsed as a key for this algorithm.
 */
export async function importSigningKey(
  privateKeyPem: string,
  algorithm: JwtAlgorithm
): Promise<SigningKeyMaterial> {
  const signingKey = await importPKCS8(privateKeyPem, algorithm, {
    extractable: true
  })
  const publicJwk = await toPublicJwk(await exportJWK(signingKey), algorithm)

  // The thumbprint is always set by `toPublicJwk`; the fallback only satisfies
  // jose's `JWK` type, where `kid` is optional.
  return { signingKey, kid: publicJwk.kid ?? "", publicJwk }
}
