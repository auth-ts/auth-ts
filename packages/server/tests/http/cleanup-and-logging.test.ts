import { describe, expect, it, vi } from "vitest"
import type { AuthDeleteInput } from "../../src/core/auth-db"
import { createTestServer } from "../helpers/create-test-server"
import { readSetCookies, request } from "../helpers/request"
import { required } from "../helpers/required"

/** Lets any work a request scheduled after its response settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Whether a delete is the sweep — the only delete keyed on an expiry range. */
const isSweep = (input: AuthDeleteInput) => {
  const expiresAt = (input.where as Record<string, unknown>).expiresAt
  return (
    typeof expiresAt === "object" &&
    expiresAt !== null &&
    !(expiresAt instanceof Date)
  )
}

describe("sweeping", () => {
  type TestContext = Awaited<ReturnType<typeof createTestServer>>

  const sendCode = (email = "ada@example.com") =>
    request("POST", "/api/auth/sign-in/send-code", { body: { email } })

  const signIn = async (context: TestContext, email = "ada@example.com") => {
    await context.authServer.handler(sendCode(email))
    return context.authServer.handler(
      request("POST", "/api/auth/sign-in/code", {
        body: { email, code: required(context.sentCodes.at(-1), "code").code }
      })
    )
  }

  const seedExpiredSession = (context: TestContext) =>
    context.db.insert({
      table: "sessions",
      values: {
        userId: "someone-long-gone",
        tokenHash: "stale-hash",
        expiresAt: new Date(Date.now() - 1000),
        userAgent: null,
        ipAddress: null,
        createdAt: new Date(Date.now() - 2000),
        updatedAt: new Date(Date.now() - 2000)
      }
    })

  it("a sign-in sweeps expired sessions, including someone else's", async () => {
    const context = await createTestServer()
    await seedExpiredSession(context)

    await signIn(context)

    const remaining = context.db.sessions()
    expect(remaining).toHaveLength(1)
    expect(
      required(remaining[0], "session").expiresAt.getTime()
    ).toBeGreaterThan(Date.now())
  })

  it("sending a code sweeps expired verification rows", async () => {
    const context = await createTestServer()
    await context.db.insert({
      table: "verifications",
      values: {
        identifier: "grace@example.com",
        codeHash: "stale-code",
        expiresAt: new Date(Date.now() - 1000),
        purpose: "signIn",
        createdAt: new Date(Date.now() - 2000),
        updatedAt: new Date(Date.now() - 2000)
      }
    })

    await context.authServer.handler(sendCode())

    const remaining = context.db.rows("verifications")
    expect(remaining).toHaveLength(1)
    expect(required(remaining[0], "code").identifier).toBe("ada@example.com")
  })

  it("hands the sweep to waitUntil instead of making the request wait", async () => {
    const deferred: Promise<unknown>[] = []
    const context = await createTestServer({
      waitUntil: (promise) => deferred.push(promise)
    })
    await seedExpiredSession(context)

    await signIn(context)

    expect(deferred.length).toBeGreaterThan(0)
    await Promise.all(deferred)
    expect(context.db.sessions()).toHaveLength(1)
  })

  it("routes a failed sweep to the logger and never into the response", async () => {
    const context = await createTestServer()
    const realDelete = context.db.delete.bind(context.db)
    vi.spyOn(context.db, "delete").mockImplementation((input) =>
      isSweep(input)
        ? Promise.reject(new Error("connection lost"))
        : realDelete(input)
    )

    const response = await signIn(context)

    expect(response.status).toBe(200)
    expect(
      context.logCalls.some(
        (call) => call.level === "error" && call.message.includes("sweep")
      )
    ).toBe(true)
  })
})

describe("logging redaction", () => {
  it("never lets a token, code, code hash, or cookie value reach the sink at any level", async () => {
    const context = await createTestServer({ guest: true, logLevel: "debug" })

    await context.authServer.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    const sent = required(context.sentCodes.at(-1), "sent code")

    const verifyResponse = await context.authServer.handler(
      request("POST", "/api/auth/sign-in/code", {
        body: { email: "ada@example.com", code: sent.code }
      })
    )
    const refreshToken = required(
      readSetCookies(verifyResponse).get("auth-ts.refresh"),
      "refresh"
    ).value
    const { token } = (await verifyResponse.json()) as {
      token: string
    }
    const cookies = { "auth-ts.refresh": refreshToken }

    await context.authServer.handler(
      request("GET", "/api/auth/user", { cookies })
    )
    await context.authServer.handler(
      request("GET", "/api/auth/sessions", { cookies })
    )
    await context.authServer.handler(request("POST", "/api/auth/sign-in/guest"))
    await context.authServer.handler(
      request("POST", "/api/auth/sign-out", { cookies })
    )
    await settle()

    const logged = JSON.stringify(context.logCalls)
    const codeHash = required(context.db.sessions()[0], "session")?.tokenHash

    expect(context.logCalls.length).toBeGreaterThan(0)
    expect(logged).not.toContain(refreshToken)
    expect(logged).not.toContain(sent.code)
    expect(logged).not.toContain(token)
    if (codeHash) expect(logged).not.toContain(codeHash)
  })

  it("keeps identifiers out of error, warn, and info", async () => {
    const context = await createTestServer({ logLevel: "info" })

    await context.authServer.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    await context.authServer.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    await settle()

    const aboveDebug = context.logCalls.filter((call) => call.level !== "debug")
    expect(JSON.stringify(aboveDebug)).not.toContain("ada@example.com")
  })

  it("emits nothing at all when silenced", async () => {
    const context = await createTestServer({ logLevel: "silent" })

    await context.authServer.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    await context.authServer.handler(request("GET", "/api/auth/user"))
    await settle()

    expect(context.logCalls).toHaveLength(0)
  })

  it("sends output to a custom sink rather than the console", async () => {
    const context = await createTestServer({ logLevel: "debug" })
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {})

    await context.authServer.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    await context.authServer.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )

    expect(context.logCalls.length).toBeGreaterThan(0)
    expect(consoleWarn).not.toHaveBeenCalled()
  })
})
