import { describe, expect, it, vi } from "vitest"
import type { AuthCondition } from "../../src/core/auth-database"
import { createTestServer } from "../helpers/create-test-server"
import {
  readRefreshCookie,
  refreshCookieFor,
  request
} from "../helpers/request"
import { required } from "../helpers/required"

/** Lets any work a request scheduled after its response settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Whether a delete is the sweep — the only delete keyed on an expiry range. */
const isSweep = ({ where }: { where: object }) => {
  const { expiresAt } = where as { expiresAt?: AuthCondition<Date> }
  return expiresAt !== undefined && "lt" in expiresAt
}

describe("sweeping", () => {
  type TestContext = Awaited<ReturnType<typeof createTestServer>>

  const sendCode = (email = "ada@example.com") =>
    request("POST", "/api/auth/sign-in/send-code", { body: { email } })

  const signIn = async (context: TestContext, email = "ada@example.com") => {
    await context.auth.handler(sendCode(email))
    return context.auth.handler(
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

    await context.auth.handler(sendCode())

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

describe("an unhandled throw", () => {
  const failing = {
    email: {
      sendCode: () => {
        throw new Error("smtp says relay access denied for ada@example.com")
      }
    }
  }

  it("answers the standard envelope, localized like every other code", async () => {
    const { auth } = await createTestServer({
      ...failing,
      localization: {
        defaultLocale: "en",
        messages: { de: { internalError: "Etwas ist schiefgelaufen." } }
      }
    })

    const response = await auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" },
        headers: { "accept-language": "de" }
      })
    )

    expect(response.status).toBe(500)
    expect(response.headers.get("content-type")).toBe("application/json")
    expect(await response.json()).toEqual({
      name: "AuthError",
      code: "internalError",
      message: "Etwas ist schiefgelaufen."
    })
  })

  it("says nothing about what failed, whatever the thrown message held", async () => {
    const context = await createTestServer(failing)

    const response = await context.auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    const body = await response.text()

    expect(body).not.toContain("smtp")
    expect(body).not.toContain("ada@example.com")
    // The detail goes to the log instead, which is where it is useful.
    expect(
      context.logCalls.some(
        (call) =>
          call.level === "error" &&
          String(call.data?.error).includes("relay access denied")
      )
    ).toBe(true)
  })
})

describe("logging redaction", () => {
  it("never lets a token, code, code hash, or cookie value reach the sink at any level", async () => {
    const context = await createTestServer({ guest: true, logLevel: "debug" })

    await context.auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    const sent = required(context.sentCodes.at(-1), "sent code")

    const verifyResponse = await context.auth.handler(
      request("POST", "/api/auth/sign-in/code", {
        body: { email: "ada@example.com", code: sent.code }
      })
    )
    const refreshToken = required(
      readRefreshCookie(verifyResponse),
      "refresh"
    ).value
    const { token } = (await verifyResponse.json()) as {
      token: string
    }
    const cookies = refreshCookieFor(refreshToken)

    await context.auth.handler(
      request("POST", "/api/auth/user", {
        cookies,
        token,
        body: { name: "Ada" }
      })
    )
    await context.auth.handler(request("POST", "/api/auth/sign-in/guest"))
    await context.auth.handler(
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

    await context.auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    await context.auth.handler(
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

    await context.auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    await context.auth.handler(
      request("POST", "/api/auth/user", { body: { name: "Ada" } })
    )
    await settle()

    expect(context.logCalls).toHaveLength(0)
  })

  it("sends output to a custom sink rather than the console", async () => {
    const context = await createTestServer({ logLevel: "debug" })
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {})

    await context.auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    await context.auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )

    expect(context.logCalls.length).toBeGreaterThan(0)
    expect(consoleWarn).not.toHaveBeenCalled()
  })
})
