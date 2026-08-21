import type { AuthServerOptions } from "../../src/core/auth-server-options.ts"
import type { AuthServer } from "../../src/core/create-auth-server.ts"
import { createAuthServer } from "../../src/core/create-auth-server.ts"
import type { MemoryDb } from "../../src/lib/memory-db.ts"
import { createMemoryDb } from "../../src/lib/memory-db.ts"
import type { CapturedCode } from "./create-test-internals.ts"
import { generateTestKeys } from "./generate-test-keys.ts"

/** A real server wired to in-memory storage, with sends and logs captured. */
export interface TestServer {
  authServer: AuthServer
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
 * Builds a server through the real `createAuthServer`.
 *
 * Tests drive the same object consumers do, so the wiring itself — the registry,
 * the middleware, the router — is exercised rather than stubbed.
 */
export async function createTestServer(
  overrides: Partial<AuthServerOptions> = {}
): Promise<TestServer> {
  const { privateKeyPem } = await testKeys()
  const db = (overrides.db as MemoryDb | undefined) ?? createMemoryDb()
  const sentCodes: CapturedCode[] = []
  const logCalls: TestServer["logCalls"] = []

  const authServer = createAuthServer({
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
    logLevel: "debug",
    logger: (level, message, data) => {
      logCalls.push({ level, message, ...(data ? { data } : {}) })
    },
    ...overrides
  })

  return { authServer, db, sentCodes, logCalls }
}
