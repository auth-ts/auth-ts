import type { JWK } from "jose"
import { buildJwks } from "../jwt/build-jwks.ts"
import type { SigningKeyMaterial } from "../jwt/import-signing-key.ts"
import {
  importAdditionalPublicKey,
  importSigningKey
} from "../jwt/import-signing-key.ts"
import type { VerificationKeySet } from "../jwt/verify-token.ts"
import { createVerificationKeySet } from "../jwt/verify-token.ts"
import type { LeveledLogger } from "../lib/logger.ts"
import { createLogger } from "../lib/logger.ts"
import type { AuthDb } from "./auth-db.ts"
import type { ResolvedAuthServerOptions } from "./auth-server-options.ts"

/** Key material, imported once on first use. */
export interface KeyMaterial extends SigningKeyMaterial {
  /** Public keys published alongside the signing key during rotation. */
  additionalPublicJwks: JWK[]
  /**
   * Every published key, for local verification.
   *
   * Built from the same document `jwks.json` serves, so what this server
   * accepts and what it tells remote verifiers to accept cannot drift apart.
   */
  verificationKeys: VerificationKeySet
}

/**
 * The four things every internal function needs, passed as one argument.
 *
 * A plain struct, not a framework concept: nothing is provided or consumed, and
 * there is no lifecycle. It exists because `issueSession(internals, …)` reads
 * better than four separate parameters threaded through every call, and because
 * having it in a leaf module lets the endpoints import the type without a cycle
 * back to `createAuthServer`.
 */
export interface AuthServerInternals {
  options: ResolvedAuthServerOptions
  db: AuthDb
  log: LeveledLogger
  /**
   * Imports the key material, memoized.
   *
   * Lazy because importing a PKCS#8 key is asynchronous while construction is
   * not: `createAuthServer` stays a synchronous call that does no input/output,
   * and the key is imported on the first sign or verify.
   */
  keys(): Promise<KeyMaterial>
}

/** Builds the internals struct from resolved options. */
export function createAuthServerInternals(
  options: ResolvedAuthServerOptions
): AuthServerInternals {
  let keyMaterial: Promise<KeyMaterial> | undefined

  const loadKeys = () => {
    keyMaterial ??= (async () => {
      const material = await importSigningKey(
        options.jwt.privateKey,
        options.jwt.alg
      )
      const additionalPublicJwks = await Promise.all(
        (options.jwt.additionalPublicKeys ?? []).map((publicKeyPem) =>
          importAdditionalPublicKey(publicKeyPem, options.jwt.alg)
        )
      )
      const verificationKeys = createVerificationKeySet(
        buildJwks(material.publicJwk, additionalPublicJwks)
      )

      return { ...material, additionalPublicJwks, verificationKeys }
    })()

    return keyMaterial
  }

  return {
    options,
    db: options.db,
    log: createLogger(options.logLevel, options.logger),
    keys: loadKeys
  }
}
