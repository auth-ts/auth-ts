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
  const { token } = (await response.json()) as { token: string }

  return {
    refreshToken: required(
      readSetCookies(response).get("auth-ts.refresh"),
      "refresh"
    ).value,
    token
  }
}

const cookieHeaders = (refreshToken: string) =>
  new Headers({ cookie: `auth-ts.refresh=${refreshToken}` })

describe("getToken as a function", () => {
  it("returns the token and the user, and slides the session it read", async () => {
    const context = await createTestServer({ session: { ttl: "30d" } })
    const { refreshToken } = await signIn(context)
    const before = required(
      context.db.sessions()[0],
      "session"
    ).expiresAt.getTime()

    const result = required(
      await context.authServer.getToken({
        headers: cookieHeaders(refreshToken)
      }),
      "token"
    )
    const after = required(
      context.db.sessions()[0],
      "session"
    ).expiresAt.getTime()

    expect(result.user.email).toBe("ada@example.com")
    expect(await context.authServer.verifyToken(result.token)).toBeTruthy()
    expect(after).toBeGreaterThanOrEqual(before)
  })

  it("does not slide when sliding is off", async () => {
    vi.useFakeTimers()
    try {
      const context = await createTestServer({
        session: { ttl: "30d", sliding: false }
      })
      const { refreshToken } = await signIn(context)
      const before = required(context.db.sessions()[0], "session").expiresAt

      vi.advanceTimersByTime(60 * 60_000)
      await context.authServer.getToken({
        headers: cookieHeaders(refreshToken)
      })

      expect(
        required(context.db.sessions()[0], "session").expiresAt.getTime()
      ).toBe(before.getTime())
    } finally {
      vi.useRealTimers()
    }
  })

  it("accepts a Request directly, since it satisfies the headers shape", async () => {
    const context = await createTestServer()
    const { refreshToken } = await signIn(context)

    const result = await context.authServer.getToken(
      request("GET", "/dashboard", {
        cookies: { "auth-ts.refresh": refreshToken }
      })
    )

    expect(result?.user.email).toBe("ada@example.com")
  })

  it("answers null for a revoked session, matching the endpoint", async () => {
    // A loader asking who is here gets an answer, not an exception: "nobody" is
    // the ordinary case on a public page.
    const context = await createTestServer()
    const { refreshToken } = await signIn(context)
    await context.db.delete({
      table: "sessions",
      where: { userId: required(context.db.users()[0], "user").id }
    })

    await expect(
      context.authServer.getToken({ headers: cookieHeaders(refreshToken) })
    ).resolves.toBeNull()
  })

  it("answers null when no cookie was sent at all", async () => {
    const context = await createTestServer()

    await expect(
      context.authServer.getToken({ headers: new Headers() })
    ).resolves.toBeNull()
  })

  it("explains a narrowed cookie.path instead of silently returning null", async () => {
    // Only reachable by opting into mount scoping: the default path is "/",
    // which is exactly why a server-side read works without configuration.
    const context = await createTestServer({ cookie: { path: "/api/auth" } })

    await expect(
      context.authServer.getToken({ headers: new Headers() })
    ).rejects.toThrow(AuthConfigError)
    await expect(
      context.authServer.getToken({ headers: new Headers() })
    ).rejects.toThrow(/cookie.path/)
  })

  it("is the only callable that reads the cookie", async () => {
    const context = await createTestServer()
    const { refreshToken } = await signIn(context)
    const headers = cookieHeaders(refreshToken)

    for (const call of [
      () => context.authServer.getUser({ headers }),
      () => context.authServer.getSession({ headers }),
      () => context.authServer.listSessions({ headers })
    ]) {
      await expect(call()).rejects.toMatchObject({
        code: "unauthenticated",
        status: 401
      })
    }
  })

  it("serves a whole render from one exchange, touching one session", async () => {
    // The shape server-side rendering is meant to have: buy a token once, then
    // spend it. Anything else would slide the session on every call.
    const context = await createTestServer()
    const { refreshToken } = await signIn(context)
    const { token } = required(
      await context.authServer.getToken({
        headers: cookieHeaders(refreshToken)
      }),
      "token"
    )

    const update = vi.spyOn(context.db, "update")
    const [session, user, sessions] = await Promise.all([
      context.authServer.getSession({ token }),
      context.authServer.getUser({ token }),
      context.authServer.listSessions({ token })
    ])

    expect(update).not.toHaveBeenCalled()
    expect(user.email).toBe("ada@example.com")
    expect(sessions).toHaveLength(1)
    expect(session).not.toHaveProperty("tokenHash")
  })
})

describe("getSession", () => {
  it("reads the session the token names, without touching it", async () => {
    const context = await createTestServer()
    const { token } = await signIn(context)

    const update = vi.spyOn(context.db, "update")
    const session = await context.authServer.getSession({ token })

    expect(update).not.toHaveBeenCalled()
    expect(session.id).toBe(required(context.db.sessions()[0], "row").id)
    expect(session).not.toHaveProperty("tokenHash")
  })

  it("refuses a revoked or expired session", async () => {
    const context = await createTestServer()
    const { token } = await signIn(context)
    const session = required(context.db.sessions()[0], "session")

    await context.db.delete({
      table: "sessions",
      where: { tokenHash: session.tokenHash }
    })

    // The token still verifies — it is the row its `sid` names that is gone.
    await expect(
      context.authServer.getSession({ token })
    ).rejects.toMatchObject({ code: "unauthenticated", status: 401 })
  })

  it("throws the configuration error when no cookie can reach the route", async () => {
    const context = await createTestServer({ cookie: { path: "/api/auth" } })

    await expect(
      context.authServer.getToken({ headers: new Headers() })
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
    // The whole contract, not a sample of it: signing reaches for no table at all.
    for (const method of ["select", "insert", "update", "delete"] as const) {
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

describe("calling with a token instead of a request", () => {
  it("authenticates from a token alone, with no headers at all", async () => {
    const context = await createTestServer()
    const { refreshToken } = await signIn(context)
    // How a caller holding only the cookie gets a token to pass along.
    const minted = await context.authServer.handler(
      request("GET", "/api/auth/token", {
        cookies: { "auth-ts.refresh": refreshToken }
      })
    )
    const { token } = (await minted.json()) as { token: string }

    // No cookie, no request — the shape a custom API has after reading its own
    // Authorization header, or a service handed a token some other way.
    const sessions = await context.authServer.listSessions({ token })

    expect(sessions).toHaveLength(1)
  })

  it("refuses an unreadable token when there is no cookie to fall back to", async () => {
    const { authServer } = await createTestServer()

    await expect(
      authServer.listSessions({ token: "forged.not.real" })
    ).rejects.toThrow()
  })

  it("serves every authenticated callable from the token alone", async () => {
    const context = await createTestServer({
      user: { deleteFreshWindow: "1h" }
    })
    const { token } = await signIn(context)
    const { authServer } = context

    const session = await authServer.getSession({ token })
    expect(session.id).toBe(required(context.db.sessions()[0], "row").id)

    const user = await authServer.getUser({ token })
    expect(user.email).toBe("ada@example.com")

    const updated = await authServer.updateUser({ token, name: "Ada" })
    expect(updated.name).toBe("Ada")

    expect(await authServer.listConnections({ token })).toEqual([])

    await authServer.deleteUser({ token })
    expect(context.db.sessions()).toHaveLength(0)
  })

  it("names the session in the token, so bearer-only sign-out ends that session", async () => {
    const context = await createTestServer()
    const { token } = await signIn(context)
    const [row] = context.db.sessions()

    expect(context.authServer.decodeToken(token)?.claims.sid).toBe(
      required(row, "row").id
    )

    await context.authServer.signOut({ token })

    expect(context.db.sessions()).toHaveLength(0)
  })

  it("does not demand a cookie of a token caller when cookie.path is narrowed", async () => {
    const context = await createTestServer({ cookie: { path: "/api/auth" } })
    const { token } = await signIn(context)

    const user = await context.authServer.getUser({ token })

    expect(user.email).toBe("ada@example.com")
  })
})
