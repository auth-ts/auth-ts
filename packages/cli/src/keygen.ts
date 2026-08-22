import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
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
  /** Where `jwks.json` is written. Created if it is not there. */
  directory: string
  /** Generate everything and write nothing. `jwksPath` is where it would have gone. */
  dry?: boolean
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
  /** The key set that was written. */
  jwks: Jwks
  /** Absolute path of the written `jwks.json`. */
  jwksPath: string
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
 * Generates a signing key and a server secret, and writes the public key set
 * to `jwks.json`.
 *
 * It lands in the working directory unless `directory` says otherwise —
 * `--out public` in a framework that serves that folder, which is what makes
 * the file reachable at `<origin>/jwks.json`, the URL a verifier is pointed at.
 * The file belongs to the key: to rotate, run this again and deploy the new key
 * and the new file together.
 */
export async function keygen({
  algorithm,
  directory,
  dry = false
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
  const jwksPath = resolve(directory, "jwks.json")
  if (!dry) {
    await mkdir(directory, { recursive: true })
    await writeFile(jwksPath, `${JSON.stringify(jwks, null, 2)}\n`)
  }

  return { privateKeyPem, secret, jwks, jwksPath }
}
