import { describe, expect, it, vi } from "vitest"
import { createTestServer } from "../helpers/create-test-server.ts"
import { readSetCookies, request } from "../helpers/request.ts"
import { required } from "../helpers/required.ts"

/** Waits for fire-and-forget work scheduled during a request. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("cleanup", () => {
  it("sweeps after a mutating request", async () => {
    const context = await createTestServer()
    const deleteExpired = vi.spyOn(context.db, "deleteExpired")

    await context.authServer.handler(
      request("POST", "/api/auth/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    await settle()

    expect(deleteExpired).toHaveBeenCalled()
  })

  it("never sweeps when cleanup is disabled", async () => {
    const context = await createTestServer({ cleanup: false })
    const deleteExpired = vi.spyOn(context.db, "deleteExpired")

    await context.authServer.handler(
      request("POST", "/api/auth/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    await settle()

    expect(deleteExpired).not.toHaveBeenCalled()
  })

  it("does not let a slow sweep delay the response", async () => {
    const context = await createTestServer()
    let released: (() => void) | undefined
    vi.spyOn(context.db, "deleteExpired").mockImplementation(
      () => new Promise<void>((resolve) => (released = resolve))
    )

    const response = await context.authServer.handler(
      request("POST", "/api/auth/send-code", {
        body: { email: "ada@example.com" }
      })
    )

    expect(response.status).toBe(200)
    released?.()
  })

  it("routes a failed sweep to the logger instead of an empty catch", async () => {
    const context = await createTestServer()
    vi.spyOn(context.db, "deleteExpired").mockRejectedValue(
      new Error("connection lost")
    )

    const response = await context.authServer.handler(
      request("POST", "/api/auth/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    await settle()

    expect(response.status).toBe(200)
    expect(
      context.logCalls.some(
        (call) =>
          call.level === "error" && call.message.includes("deleteExpired")
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
    const { accessToken } = (await verifyResponse.json()) as {
      accessToken: string
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
      request("POST", "/api/auth/logout", { cookies })
    )
    await settle()

    const logged = JSON.stringify(context.logCalls)
    const codeHash = required(context.db.sessions()[0], "session")?.tokenHash

    expect(context.logCalls.length).toBeGreaterThan(0)
    expect(logged).not.toContain(refreshToken)
    expect(logged).not.toContain(sent.code)
    expect(logged).not.toContain(accessToken)
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
