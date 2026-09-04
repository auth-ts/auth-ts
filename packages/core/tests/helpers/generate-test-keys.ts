import { exportPKCS8, exportSPKI, generateKeyPair } from "jose"
import type { JwtAlgorithm } from "../../src/jwt/import-signing-key"

/** A generated key pair in the PEM formats the library's options accept. */
export interface TestKeyPair {
  privateKeyPem: string
  publicKeyPem: string
}

/** Generates a real key pair so tests exercise the same import path as production. */
export async function generateTestKeys(
  algorithm: JwtAlgorithm = "RS256"
): Promise<TestKeyPair> {
  const { privateKey, publicKey } = await generateKeyPair(algorithm, {
    extractable: true
  })

  return {
    privateKeyPem: await exportPKCS8(privateKey),
    publicKeyPem: await exportSPKI(publicKey)
  }
}
