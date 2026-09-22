import type { AuthOptions } from "../../src/core/auth-options"
import type { Auth } from "../../src/core/create-auth"
import { createAuth } from "../../src/core/create-auth"
import type { MemoryDatabase } from "../../src/lib/memory-database"
import { createMemoryDatabase } from "../../src/lib/memory-database"
import type { CapturedCode } from "./create-test-internals"
import { generateTestKeys } from "./generate-test-keys"
import { readSetCookies } from "./request"

const ATTEMPT_COOKIES = ["auth-ts.attempt", "auth-ts.attempt.delete"]

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
 *
 * The handler keeps the cookies a browser would: an attempt cookie a send sets
 * rides on every later request that does not carry its own, so a test reads as
 * one client asking for a code and then presenting it. A test that wants to be
 * a different client passes the cookie explicitly.
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

  const jar = new Map<string, string>()
  const handler: Auth["handler"] = async (incoming) => {
    const cookie = incoming.headers.get("cookie")
    const carried = [...jar]
      .filter(([name]) => !cookie?.includes(`${name}=`))
      .map(([name, value]) => `${name}=${value}`)
    let request = incoming
    if (carried.length > 0) {
      const headers = new Headers(incoming.headers)
      headers.set("cookie", [cookie, ...carried].filter(Boolean).join("; "))
      request = new Request(incoming, { headers })
    }
    const response = await auth.handler(request)
    for (const [name, { value }] of readSetCookies(response)) {
      if (ATTEMPT_COOKIES.includes(name)) jar.set(name, value)
    }
    return response
  }

  return { auth: { ...auth, handler }, db, sentCodes, logCalls }
}
