import type { JWK } from "jose"
import {
  calculateJwkThumbprint,
  exportJWK,
  exportPKCS8,
  generateKeyPair
} from "jose"

/** The signing algorithms `@auth-ts/server` accepts. */
export type JwtAlgorithm = "RS256" | "ES256"

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
  /** 32 random bytes, base64 — the value of `AUTH_SECRET`. */
  secret: string
  /** The public key set. */
  jwks: Jwks
}

/**
 * The public JWK for this key, as `@auth-ts/server` identifies it.
 *
 * The public members only, then `alg`, `use`, and the RFC 7638 thumbprint as
 * `kid` — the same `kid` the server stamps on every token header, which is how
 * a verifier holding this file picks the key.
 */
async function toPublicJwk(publicKey: CryptoKey, algorithm: JwtAlgorithm) {
  const jwk = await exportJWK(publicKey)
  const kid = await calculateJwkThumbprint(jwk)

  return { ...jwk, alg: algorithm, use: "sig", kid }
}

/**
 * Generates a signing key, a server secret, and the public key set.
 *
 * Nothing is written here. What the command does with the three is its own
 * decision, and the default is to print them and leave the filesystem alone.
 */
export async function keygen({
  algorithm
}: KeygenOptions): Promise<KeygenResult> {
  const { privateKey, publicKey } = await generateKeyPair(algorithm, {
    extractable: true
  })
  const privateKeyPem = await exportPKCS8(privateKey)
  // `openssl rand -base64 32`, without the shell.
  const secret = Buffer.from(
    crypto.getRandomValues(new Uint8Array(32))
  ).toString("base64")

  const jwks: Jwks = { keys: [await toPublicJwk(publicKey, algorithm)] }

  return { privateKeyPem, secret, jwks }
}
