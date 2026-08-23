import { describe, expect, it, vi } from "vitest"
import { CLEANUP_INTERVAL_MS } from "../../src/http/sweep-expired"
import { createTestServer } from "../helpers/create-test-server"
import { readSetCookies, request } from "../helpers/request"
import { required } from "../helpers/required"

/** Lets any work a request scheduled after its response settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("cleanup", () => {
  const sendCode = () =>
    request("POST", "/api/auth/send-code", {
      body: { email: "ada@example.com" }
    })

  it("sweeps after a mutating request", async () => {
    const context = await createTestServer()
    const cleanup = vi.spyOn(context.db, "cleanup")

    await context.authServer.handler(sendCode())

    expect(cleanup).toHaveBeenCalled()
  })

  it("waits for the sweep rather than firing and forgetting it", async () => {
    // An unawaited promise is not guaranteed to run on Workers once the
    // response is returned, and a framework-agnostic library never sees
    // `ctx.waitUntil` — so the sweep has to be finished before the handler is.
    const context = await createTestServer()
    let swept = false
    vi.spyOn(context.db, "cleanup").mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      swept = true
    })

    await context.authServer.handler(sendCode())

    expect(swept).toBe(true)
  })

  it("sweeps at most once an interval, however many requests arrive", async () => {
    const context = await createTestServer()
    const cleanup = vi.spyOn(context.db, "cleanup")

    await context.authServer.handler(sendCode())
    await context.authServer.handler(sendCode())
    await context.authServer.handler(sendCode())

    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it("sweeps again once the interval has passed", async () => {
    const context = await createTestServer()
    const cleanup = vi.spyOn(context.db, "cleanup")

    await context.authServer.handler(sendCode())
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + CLEANUP_INTERVAL_MS + 1)
    await context.authServer.handler(sendCode())
    vi.restoreAllMocks()

    expect(cleanup).toHaveBeenCalledTimes(2)
  })

  it("never sweeps on a read, because a read creates nothing to clean up", async () => {
    const context = await createTestServer()
    const cleanup = vi.spyOn(context.db, "cleanup")

    await context.authServer.handler(request("GET", "/api/auth/jwks"))

    expect(cleanup).not.toHaveBeenCalled()
  })

  it("never sweeps when the store does not implement cleanup", async () => {
    // Leaving it off the contract is how a deployment says "my cron owns this".
    const context = await createTestServer()
    context.db.cleanup = undefined

    const response = await context.authServer.handler(sendCode())

    expect(response.status).toBe(200)
  })

  it("routes a failed sweep to the logger instead of an empty catch", async () => {
    const context = await createTestServer()
    vi.spyOn(context.db, "cleanup").mockRejectedValue(
      new Error("connection lost")
    )

    const response = await context.authServer.handler(sendCode())

    expect(response.status).toBe(200)
    expect(
      context.logCalls.some(
        (call) => call.level === "error" && call.message.includes("cleanup")
      )
    ).toBe(true)
  })
})

describe("logging redaction", () => {
  it("never lets a token, code, code hash, or cookie value reach the sink at any level", async () => {
    const context = await createTestServer({ guest: true, logLevel: "debug" })

    await context.authServer.handler(
      request("POST", "/api/auth/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    const sent = required(context.sentCodes.at(-1), "sent code")

    const verifyResponse = await context.authServer.handler(
      request("POST", "/api/auth/verify-code", {
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
      request("POST", "/api/auth/token", { cookies })
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
      request("POST", "/api/auth/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    await context.authServer.handler(
      request("POST", "/api/auth/send-code", {
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
      request("POST", "/api/auth/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    await context.authServer.handler(request("POST", "/api/auth/token"))
    await settle()

    expect(context.logCalls).toHaveLength(0)
  })

  it("sends output to a custom sink rather than the console", async () => {
    const context = await createTestServer({ logLevel: "debug" })
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {})

    await context.authServer.handler(
      request("POST", "/api/auth/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    await context.authServer.handler(
      request("POST", "/api/auth/send-code", {
        body: { email: "ada@example.com" }
      })
    )

    expect(context.logCalls.length).toBeGreaterThan(0)
    expect(consoleWarn).not.toHaveBeenCalled()
  })
})
