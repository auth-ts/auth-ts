import type { AuthOptions } from "../../src/core/auth-options"
import type { Auth } from "../../src/core/create-auth"
import { createAuth } from "../../src/core/create-auth"
import type { MemoryDatabase } from "../../src/lib/memory-database"
import { createMemoryDatabase } from "../../src/lib/memory-database"
import type { CapturedCode } from "./create-test-internals"
import { generateTestKeys } from "./generate-test-keys"

/** A real server wired to in-memory storage, with sends and logs captured. */
export interface TestServer {
  auth: Auth
  db: MemoryDatabase
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
  const db =
    (overrides.database as MemoryDatabase | undefined) ?? createMemoryDatabase()
  const sentCodes: CapturedCode[] = []
  const logCalls: TestServer["logCalls"] = []

  const auth = createAuth({
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
