import type { AuthServerInternals } from "../../src/core/auth-server-internals.ts"
import { createAuthServerInternals } from "../../src/core/auth-server-internals.ts"
import type { AuthServerOptions } from "../../src/core/auth-server-options.ts"
import { resolveAuthServerOptions } from "../../src/core/auth-server-options.ts"
import type { LogLevel } from "../../src/lib/logger.ts"
import type { MemoryDb } from "../../src/lib/memory-db.ts"
import { createMemoryDb } from "../../src/lib/memory-db.ts"
import { generateTestKeys } from "./generate-test-keys.ts"

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
  internals: AuthServerInternals
  db: MemoryDb
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
 * Builds internals backed by {@link createMemoryDb}, capturing sends and logs.
 *
 * @param overrides - Any server option; `db`, `email`, and the key default here.
 */
export async function createTestInternals(
  overrides: Partial<AuthServerOptions> & { logLevel?: LogLevel } = {}
): Promise<TestInternals> {
  const { privateKeyPem } = await testKeys()
  const db = (overrides.db as MemoryDb | undefined) ?? createMemoryDb()
  const sentCodes: CapturedCode[] = []
  const logCalls: TestInternals["logCalls"] = []

  const options = resolveAuthServerOptions({
    db,
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
    jwt: { privateKey: privateKeyPem },
    secret: "test-server-secret",
    logLevel: overrides.logLevel ?? "debug",
    logger: (level, message, data) => {
      logCalls.push({ level, message, ...(data ? { data } : {}) })
    },
    ...overrides,
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
    internals: createAuthServerInternals(options),
    db,
    sentCodes,
    logCalls,
    privateKeyPem
  }
}
