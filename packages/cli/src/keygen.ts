import type { JwtAlgorithm } from "@auth-ts/core"
import { importSigningKey } from "@auth-ts/core"
import type { JWK } from "jose"
import { exportPKCS8, generateKeyPair } from "jose"

/** What `keygen` needs to know. */
export interface KeygenOptions {
  /** The signing algorithm the key is for. */
  algorithm: JwtAlgorithm
}

/** The public key set, as written to `jwks.json`. */
export interface Jwks {
  keys: JWK[]
}

/** Everything `keygen` produced. */
export interface KeygenResult {
  /** PKCS#8 PEM — the value of `JWT_PRIVATE_KEY`. */
  privateKeyPem: string
  /** The public key set. */
  jwks: Jwks
}

/**
 * Generates a signing key and the public key set.
 *
 * Nothing is written here. What the command does with the two is its own
 * decision, and the default is to print them and leave the filesystem alone.
 */
export async function keygen({
  algorithm
}: KeygenOptions): Promise<KeygenResult> {
  const { privateKey } = await generateKeyPair(algorithm, { extractable: true })
  const privateKeyPem = await exportPKCS8(privateKey)
  // The server's own derivation, so the kid always matches
  const { publicJwk } = await importSigningKey(privateKeyPem, algorithm)
  const jwks: Jwks = { keys: [publicJwk] }

  return { privateKeyPem, jwks }
}
