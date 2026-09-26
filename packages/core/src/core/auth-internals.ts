import type { SigningKeyMaterial } from "../jwt/import-signing-key"
import { importSigningKey } from "../jwt/import-signing-key"
import type { VerificationKeySet } from "../jwt/verify-token"
import { createVerificationKeySet } from "../jwt/verify-token"
import type { LeveledLogger } from "../lib/logger"
import { createLogger } from "../lib/logger"
import type { AuthConfig } from "./auth-config"
import type { AuthDatabase } from "./auth-database"

/** Key material, imported once on first use. */
export interface KeyMaterial extends SigningKeyMaterial {
  /**
   * What local verification accepts: the signing key's public half, as the
   * one-key set the published `jwks.json` is — so what the server accepts and
   * what it tells remote verifiers to accept cannot drift apart.
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
 * back to `createAuth`.
 */
export interface AuthInternals {
  /** The resolved configuration — options after defaults and validation. */
  config: AuthConfig
  db: AuthDatabase
  log: LeveledLogger
  /**
   * Logs a warning the first time each `key` is seen, and never again.
   *
   * For conditions only a request can discover — a forwarded header that turns
   * out to be unusable, say. Saying it on every request would bury the log it
   * belongs in; saying it once is what makes it readable. Per server, not per
   * process, so two servers in one process each get their say and tests do not
   * inherit a warning from the test before.
   */
  warnOnce(key: string, message: string, data?: Record<string, unknown>): void
  /**
   * Imports the key material, memoized.
   *
   * Lazy because importing a PKCS#8 key is asynchronous while construction is
   * not: `createAuth` stays a synchronous call that does no input/output,
   * and the key is imported on the first sign or verify.
   */
  keys(): Promise<KeyMaterial>
}

/** Builds the internals struct from the resolved configuration. */
export function createAuthInternals(config: AuthConfig): AuthInternals {
  const log = createLogger(config.logLevel, config.logger)
  const warned = new Set<string>()
  let keyMaterial: Promise<KeyMaterial> | undefined

  const loadKeys = () => {
    keyMaterial ??= (async () => {
      const material = await importSigningKey(
        config.jwt.privateKey,
        config.jwt.alg
      )

      return {
        ...material,
        verificationKeys: createVerificationKeySet(material.publicJwk)
      }
    })()

    return keyMaterial
  }

  return {
    config,
    db: config.db,
    log,
    warnOnce(key, message, data) {
      if (warned.has(key)) return
      warned.add(key)
      log.warn(message, data)
    },
    keys: loadKeys
  }
}
