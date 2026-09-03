import type { AuthOptions } from "../../src/core/auth-options"
import type { Auth } from "../../src/core/create-auth"
import { createAuth } from "../../src/core/create-auth"
import type { MemoryDb } from "../../src/lib/memory-db"
import { createMemoryDb } from "../../src/lib/memory-db"
import type { CapturedCode } from "./create-test-internals"
import { generateTestKeys } from "./generate-test-keys"

/** A real server wired to in-memory storage, with sends and logs captured. */
export interface TestServer {
  auth: Auth
  db: MemoryDb
  sentCodes: CapturedCode[]
  logCalls: Array<{
    level: string
    message: string
    data?: Record<string, unknown>
  }>
}

let cachedKeys:
  | Promise<{ privateKeyPem: string; publicKeyPem: string }>
  | undefined

function testKeys() {
  cachedKeys ??= generateTestKeys("RS256")
  return cachedKeys
}

/**
 * Builds a server through the real `createAuth`.
 *
 * Tests drive the same object consumers do, so the wiring itself — the registry,
 * the middleware, the router — is exercised rather than stubbed.
 */
export async function createTestServer(
  overrides: Partial<AuthOptions> = {}
): Promise<TestServer> {
  const { privateKeyPem } = await testKeys()
  const db = (overrides.db as MemoryDb | undefined) ?? createMemoryDb()
  const sentCodes: CapturedCode[] = []
  const logCalls: TestServer["logCalls"] = []

  const auth = createAuth({
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
    secret: "test-server-secret-long-enough-to-pass",
    logLevel: "debug",
    logger: (level, message, data) => {
      logCalls.push({ level, message, ...(data ? { data } : {}) })
    },
    ...overrides
  })

  return { auth, db, sentCodes, logCalls }
}
