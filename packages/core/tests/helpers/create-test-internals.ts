import { resolveAuthConfig } from "../../src/core/auth-config"
import type { AuthInternals } from "../../src/core/auth-internals"
import { createAuthInternals } from "../../src/core/auth-internals"
import type { AuthOptions } from "../../src/core/auth-options"
import type { LogLevel } from "../../src/lib/logger"
import type { MemoryDatabase } from "../../src/lib/memory-database"
import { createMemoryDatabase } from "../../src/lib/memory-database"
import { generateTestKeys } from "./generate-test-keys"

/** A code captured from an email or SMS send, so tests never guess at one. */
export interface CapturedCode {
  channel: "email" | "sms"
  destination: string
  code: string
  locale: string
  purpose: "signIn" | "deleteUser"
  headers: Headers
}

/** A server wired to in-memory storage, with everything a test needs to inspect. */
export interface TestInternals {
  internals: AuthInternals
  db: MemoryDatabase
  /** Every code "delivered", in order. */
  sentCodes: CapturedCode[]
  /** Every call made to the log sink. */
  logCalls: Array<{
    level: string
    message: string
    data?: Record<string, unknown>
  }>
  privateKeyPem: string
}

let cachedKeys:
  | Promise<{ privateKeyPem: string; publicKeyPem: string }>
  | undefined

/** Generating an RSA key is slow, so the suite shares one across tests. */
function testKeys() {
  cachedKeys ??= generateTestKeys("RS256")
  return cachedKeys
}

/**
 * Builds internals backed by {@link createMemoryDatabase}, capturing sends and logs.
 *
 * @param overrides - Any server option; `database`, `email`, and the key default here.
 */
export async function createTestInternals(
  overrides: Partial<AuthOptions> & { logLevel?: LogLevel } = {}
): Promise<TestInternals> {
  const { privateKeyPem } = await testKeys()
  const db =
    (overrides.database as MemoryDatabase | undefined) ?? createMemoryDatabase()
  const sentCodes: CapturedCode[] = []
  const logCalls: TestInternals["logCalls"] = []

  const config = resolveAuthConfig({
    database: db,
    email: {
      sendCode: ({ email, code, locale, purpose, headers }) => {
        sentCodes.push({
          channel: "email",
          destination: email,
          code,
          locale,
          purpose,
          headers
        })
      }
    },
    secret: "test-server-secret-long-enough-to-pass",
    logLevel: overrides.logLevel ?? "debug",
    logger: (level, message, data) => {
      logCalls.push({ level, message, ...(data ? { data } : {}) })
    },
    ...overrides,
    // Merged rather than replaced, so a test overriding one jwt option does not
    // have to know it is also holding the signing key.
    jwt: { privateKey: privateKeyPem, ...overrides.jwt },
    ...(overrides.sms
      ? {
          sms: {
            sendCode: ({ phoneNumber, code, locale, purpose, headers }) => {
              sentCodes.push({
                channel: "sms",
                destination: phoneNumber,
                code,
                locale,
                purpose,
                headers
              })
            }
          }
        }
      : {})
  })

  return {
    internals: createAuthInternals(config),
    db,
    sentCodes,
    logCalls,
    privateKeyPem
  }
}
