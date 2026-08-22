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
import type { AuthDB } from "./auth-db.ts"
import type { AuthServerConfig } from "./auth-server-config.ts"

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
  /** The resolved configuration — options after defaults and validation. */
  config: AuthServerConfig
  db: AuthDB
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

/** Builds the internals struct from the resolved configuration. */
export function createAuthServerInternals(
  config: AuthServerConfig
): AuthServerInternals {
  const log = createLogger(config.logLevel, config.logger)
  let keyMaterial: Promise<KeyMaterial> | undefined

  const loadKeys = () => {
    keyMaterial ??= (async () => {
      const material = await importSigningKey(
        config.jwt.privateKey,
        config.jwt.alg
      )
      const imported = await Promise.all(
        (config.jwt.additionalPublicKeys ?? []).map((publicKeyPem) =>
          importAdditionalPublicKey(publicKeyPem, config.jwt.alg)
        )
      )

      // One entry per key. The kid is the key's thumbprint, so the signing key
      // listed again in `additionalPublicKeys` — the easy slip at the rotation
      // switch — or the same key pasted twice would publish duplicate kids, and
      // jose refuses to pick between two matching keys: every local
      // verification would fail. Keys import lazily, after construction, so
      // this cannot be a startup error; it is dropped and said out loud instead.
      const published = new Set([material.kid])
      const additionalPublicJwks: JWK[] = []
      for (const jwk of imported) {
        if (jwk.kid && published.has(jwk.kid)) {
          log.warn("ignoring a duplicate key in jwt.additionalPublicKeys", {
            kid: jwk.kid
          })
          continue
        }
        if (jwk.kid) published.add(jwk.kid)
        additionalPublicJwks.push(jwk)
      }

      const verificationKeys = createVerificationKeySet(
        buildJwks(material.publicJwk, additionalPublicJwks)
      )

      return { ...material, additionalPublicJwks, verificationKeys }
    })()

    return keyMaterial
  }

  return {
    config,
    db: config.db,
    log,
    keys: loadKeys
  }
}
