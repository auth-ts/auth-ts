import { describe, expect, it, vi } from "vitest"
import { AuthConfigError } from "../../src/http/auth-config-error"
import { createTestServer } from "../helpers/create-test-server"
import { readSetCookies, request } from "../helpers/request"
import { required } from "../helpers/required"

type TestContext = Awaited<ReturnType<typeof createTestServer>>

async function signIn(context: TestContext) {
  await context.authServer.handler(
    request("POST", "/api/auth/send-code", {
      body: { email: "ada@example.com" }
    })
  )
  const response = await context.authServer.handler(
    request("POST", "/api/auth/verify-code", {
      body: {
        email: "ada@example.com",
        code: required(context.sentCodes.at(-1), "code").code
      }
    })
  )

  return required(readSetCookies(response).get("auth-ts.refresh"), "refresh")
    .value
}

const cookieHeaders = (refreshToken: string) =>
  new Headers({ cookie: `auth-ts.refresh=${refreshToken}` })

describe("getToken as a function", () => {
  it("matches POST /token exactly, including sliding the session", async () => {
    const context = await createTestServer({
      cookie: { path: "/" },
      session: { ttl: "30d" }
    })
    const refreshToken = await signIn(context)

    const before = required(
      context.db.sessions()[0],
      "session"
    ).expiresAt.getTime()
    const result = await context.authServer.getToken({
      headers: cookieHeaders(refreshToken)
    })
    const after = required(
      context.db.sessions()[0],
      "session"
    ).expiresAt.getTime()

    expect(result?.user.email).toBe("ada@example.com")
    // Shares run() with POST /token, so it gets the same projection — no hash.
    expect(JSON.stringify(result)).not.toContain("tokenHash")
    expect(
      (
        await context.authServer.verifyToken(
          required(result, "result").accessToken
        )
      )?.sub
    ).toBe(result?.user.id)
    expect(after).toBeGreaterThanOrEqual(before)
  })

  it("reports the expiry sliding just persisted, not the one it read", async () => {
    vi.useFakeTimers()
    try {
      const context = await createTestServer({
        cookie: { path: "/" },
        session: { ttl: "30d" }
      })
      const refreshToken = await signIn(context)
      const before = required(context.db.sessions()[0], "session").expiresAt

      vi.advanceTimersByTime(60 * 60_000)
      const result = required(
        await context.authServer.getToken({
          headers: cookieHeaders(refreshToken)
        }),
        "result"
      )
      const stored = required(context.db.sessions()[0], "session").expiresAt

      // Regression: this returned `before` — the row as it was before the slide.
      expect(stored.getTime()).toBeGreaterThan(before.getTime())
      expect(result.session.expiresAt.getTime()).toBe(stored.getTime())
    } finally {
      vi.useRealTimers()
    }
  })

  it("reports the unchanged expiry when sliding is off", async () => {
    vi.useFakeTimers()
    try {
      const context = await createTestServer({
        cookie: { path: "/" },
        session: { ttl: "30d", sliding: false }
      })
      const refreshToken = await signIn(context)
      const before = required(context.db.sessions()[0], "session").expiresAt

      vi.advanceTimersByTime(60 * 60_000)
      const result = required(
        await context.authServer.getToken({
          headers: cookieHeaders(refreshToken)
        }),
        "result"
      )

      expect(result.session.expiresAt.getTime()).toBe(before.getTime())
      expect(
        required(context.db.sessions()[0], "session").expiresAt.getTime()
      ).toBe(before.getTime())
    } finally {
      vi.useRealTimers()
    }
  })

  it("accepts a Request directly, since it satisfies the headers shape", async () => {
    const context = await createTestServer({ cookie: { path: "/" } })
    const refreshToken = await signIn(context)

    const result = await context.authServer.getToken(
      request("GET", "/dashboard", {
        cookies: { "auth-ts.refresh": refreshToken }
      })
    )

    expect(result?.user.email).toBe("ada@example.com")
  })

  it("throws unauthenticated for a revoked session, matching the endpoint", async () => {
    // Callables throw AuthApiError so a caller can switch on `code`; getSession is
    // the one that answers null, because "is anyone signed in" is a question with
    // a legitimate negative answer.
    const context = await createTestServer({ cookie: { path: "/" } })
    const refreshToken = await signIn(context)
    await context.db.deleteSessions({
      userId: required(context.db.users()[0], "user").id
    })

    await expect(
      context.authServer.getToken({ headers: cookieHeaders(refreshToken) })
    ).rejects.toMatchObject({
      code: "unauthenticated",
      status: 401
    })
  })

  it("explains the cookie.path trap instead of silently returning null", async () => {
    const context = await createTestServer()

    await expect(
      context.authServer.getToken({ headers: new Headers() })
    ).rejects.toThrow(AuthConfigError)
    await expect(
      context.authServer.getToken({ headers: new Headers() })
    ).rejects.toThrow(/cookie.path/)
  })
})

describe("getSession", () => {
  it("resolves the session and user without minting a token", async () => {
    const context = await createTestServer({ cookie: { path: "/" } })
    const refreshToken = await signIn(context)

    const result = await context.authServer.getSession({
      headers: cookieHeaders(refreshToken)
    })

    expect(result?.user.email).toBe("ada@example.com")
    expect(result?.session.id).toBeTruthy()
    // The server-side primitive deliberately returns the full row, hash included:
    // this has no HTTP route, and server code uses the hash (e.g. deleteSession).
    // Only POST /token and getToken() project it away.
    expect(result?.session.tokenHash).toBeTruthy()
  })

  it("resolves null for a revoked or expired session", async () => {
    const context = await createTestServer({ cookie: { path: "/" } })
    const refreshToken = await signIn(context)
    const session = required(context.db.sessions()[0], "session")

    await context.db.deleteSession({ tokenHash: session.tokenHash })
    expect(
      await context.authServer.getSession({
        headers: cookieHeaders(refreshToken)
      })
    ).toBeNull()
  })

  it("throws the configuration error when no cookie can reach the route", async () => {
    const context = await createTestServer()

    await expect(
      context.authServer.getSession({ headers: new Headers() })
    ).rejects.toThrow(AuthConfigError)
  })
})

describe("signToken and decodeToken", () => {
  it("mints an arbitrary payload that verifies", async () => {
    const { authServer } = await createTestServer()

    const token = await authServer.signToken({
      userId: "user-1",
      type: "admin",
      tenant: "acme"
    })
    const claims = await authServer.verifyToken(token)

    expect(claims?.sub).toBe("user-1")
    expect(claims?.type).toBe("admin")
    expect(claims?.tenant).toBe("acme")
  })

  it("mints a service token with no subject", async () => {
    const { authServer } = await createTestServer()

    const claims = await authServer.verifyToken(
      await authServer.signToken({ role: "service" })
    )

    expect(claims?.role).toBe("service")
    expect(claims?.sub).toBeUndefined()
  })

  it("performs no database work", async () => {
    const context = await createTestServer()
    const calls: string[] = []
    for (const method of ["getUser", "getSession", "upsertUser"] as const) {
      const original = context.db[method].bind(context.db)
      // biome-ignore lint/suspicious/noExplicitAny: test spy over a heterogeneous method set
      ;(context.db as any)[method] = (...args: unknown[]) => {
        calls.push(method)
        return (original as (...inner: unknown[]) => unknown)(...args)
      }
    }

    await context.authServer.signToken({ userId: "user-1" })

    expect(calls).toEqual([])
  })

  it("decodes an unverified token for triage and reports expiry", async () => {
    const { authServer } = await createTestServer()
    const token = await authServer.signToken({ userId: "user-1" })

    expect(authServer.decodeToken(token)?.claims.sub).toBe("user-1")
    expect(authServer.decodeToken(token)?.expired).toBe(false)
    expect(authServer.decodeToken("garbage")).toBeNull()
  })
})

describe("callables and handlers agree", () => {
  it("produces the same result whether called in-process or over HTTP", async () => {
    const jwks = { keys: [{ kty: "RSA", kid: "k1", n: "AQ", e: "AQAB" }] }
    const context = await createTestServer({ jwks: { json: jwks } })

    await context.authServer.sendCode({ email: "ada@example.com" })
    expect(required(context.sentCodes.at(-1), "code").destination).toBe(
      "ada@example.com"
    )

    const overHttp = await context.authServer.handler(
      request("GET", "/api/auth/jwks")
    )
    const inProcess = await context.authServer.getJwks(undefined as never)

    expect(await overHttp.json()).toEqual(JSON.parse(JSON.stringify(inProcess)))
  })

  it("throws a typed AuthApiError from a callable rather than returning an envelope", async () => {
    const context = await createTestServer()

    await expect(
      context.authServer.getUser({ headers: new Headers() })
    ).rejects.toMatchObject({
      code: "unauthenticated",
      status: 401
    })
  })
})
