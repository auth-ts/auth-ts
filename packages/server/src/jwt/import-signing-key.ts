import type { JWK } from "jose"
import { exportJWK, importJWK, importPKCS8, importSPKI } from "jose"

/**
 * The signing algorithm.
 *
 * Both are accepted by Neon and Supabase. RS256 is the default for the widest
 * verifier compatibility; ES256 produces smaller signatures and is one line to
 * switch to. Symmetric algorithms are structurally impossible here — a JWKS
 * endpoint cannot publish an HMAC secret without publishing the ability to forge.
 */
export type JwtAlgorithm = "RS256" | "ES256"

/** An imported key pair: what signs, what verifies, and what gets published. */
export interface SigningKeyMaterial {
  /** Private key — signs tokens, never leaves the server. */
  signingKey: CryptoKey
  /**
   * Public key — verifies tokens.
   *
   * Separate from {@link SigningKeyMaterial.signingKey} because Web Crypto
   * requires it to be: `verify` rejects a private key outright.
   */
  verificationKey: CryptoKey
  /** The public JWK, already carrying `kid`, `alg`, and `use`. */
  publicJwk: JWK
}

/** Strips the private components, leaving only what is safe to publish. */
function toPublicJwk(jwk: JWK, algorithm: JwtAlgorithm, kid: string): JWK {
  const published: JWK =
    jwk.kty === "RSA"
      ? { kty: jwk.kty, n: jwk.n, e: jwk.e }
      : { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }

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
  algorithm: JwtAlgorithm,
  kid: string
): Promise<SigningKeyMaterial> {
  const signingKey = await importPKCS8(privateKeyPem, algorithm, {
    extractable: true
  })
  const publicJwk = toPublicJwk(await exportJWK(signingKey), algorithm, kid)
  const verificationKey = (await importJWK(publicJwk, algorithm)) as CryptoKey

  return { signingKey, verificationKey, publicJwk }
}

/**
 * Imports an additional public key (SPKI PEM) to publish alongside the current one.
 *
 * Used during rotation. Its `kid` is the JWK thumbprint rather than a
 * configured name: these keys are only ever verified against, never signed with,
 * so a stable value derived from the key itself is both sufficient and impossible
 * to get wrong.
 */
export async function importAdditionalPublicKey(
  publicKeyPem: string,
  algorithm: JwtAlgorithm
): Promise<JWK> {
  const { calculateJwkThumbprint } = await import("jose")
  const key = await importSPKI(publicKeyPem, algorithm, { extractable: true })
  const jwk = await exportJWK(key)

  return toPublicJwk(jwk, algorithm, await calculateJwkThumbprint(jwk))
}
