import { describe, expect, it, vi } from "vitest"
import { AuthConfigError } from "../../src/http/auth-config-error"
import { createTestServer } from "../helpers/create-test-server"
import {
  readRefreshCookie,
  readSetCookies,
  refreshCookie,
  refreshCookieFor,
  refreshEntryOf,
  request
} from "../helpers/request"
import { required } from "../helpers/required"

type TestContext = Awaited<ReturnType<typeof createTestServer>>

async function signIn(context: TestContext) {
  await context.authServer.handler(
    request("POST", "/api/auth/sign-in/send-code", {
      body: { email: "ada@example.com" }
    })
  )
  const response = await context.authServer.handler(
    request("POST", "/api/auth/sign-in/code", {
      body: {
        email: "ada@example.com",
        code: required(context.sentCodes.at(-1), "code").code
      }
    })
  )
  const { token } = (await response.json()) as { token: string }

  return {
    refreshToken: required(readRefreshCookie(response), "refresh").value,
    token
  }
}

const cookieHeaders = (refreshToken: string, userId = "signed-in") =>
  new Headers({ cookie: `${refreshCookie(userId)}=${refreshToken}` })

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
        cookies: refreshCookieFor(refreshToken)
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

  it("throws real Errors: instanceof, name, and a human message", async () => {
    // Compile-time: the wire body is a structural `Error`, so a raw fetch
    // caller can throw the parsed JSON into anything typed `Error`.
    const wireBodyIsAnError: Error = {} as import("../../src").AuthErrorBody
    void wireBodyIsAnError

    // What an error boundary renders is `.message`, and it cannot switch on
    // `code` first — so the default message is the built-in text, never the
    // bare code.
    const context = await createTestServer()

    const thrown = await context.authServer
      .updateUser({ headers: new Headers(), name: "Ada" })
      .then(() => null)
      .catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).toMatchObject({
      name: "AuthApiError",
      code: "unauthenticated",
      status: 401,
      message: "You are not signed in."
    })
  })

  it("is the only callable that reads the cookie", async () => {
    const context = await createTestServer()
    const { refreshToken } = await signIn(context)
    const headers = cookieHeaders(refreshToken)

    for (const call of [
      () => context.authServer.updateUser({ headers, name: "Ada" }),
      () => context.authServer.deleteUser({ headers }),
      () => context.authServer.sendDeleteUserCode({ headers })
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
    const updated = await context.authServer.updateUser({ token, name: "Ada" })

    expect(updated.email).toBe("ada@example.com")
    // The user row is written, the session is not: spending a token never
    // slides it, however many calls the render makes.
    expect(
      update.mock.calls.every(([input]) => input.table !== "sessions")
    ).toBe(true)
  })

  it("re-sends the cookies over HTTP, so their Max-Age slides with the session", async () => {
    const context = await createTestServer()
    const { refreshToken } = await signIn(context)

    const response = await context.authServer.handler(
      request("GET", "/api/auth/token", {
        cookies: refreshCookieFor(refreshToken)
      })
    )
    const cookies = readSetCookies(response)

    expect(required(refreshEntryOf(cookies), "refresh").value).toBe(
      refreshToken
    )
    expect(refreshEntryOf(cookies)?.attributes).toMatch(/Max-Age/)
    // The hint names whoever is active, which is what tells the next request
    // which of several refresh cookies to spend.
    expect(required(cookies.get("auth-ts.hint"), "hint").value).toBe(
      required(context.db.users()[0], "user").id
    )
  })

  it("sets no cookies on success when sliding is off", async () => {
    const context = await createTestServer({
      session: { ttl: "30d", sliding: false }
    })
    const { refreshToken } = await signIn(context)

    const response = await context.authServer.handler(
      request("GET", "/api/auth/token", {
        cookies: refreshCookieFor(refreshToken)
      })
    )

    expect(response.headers.getSetCookie()).toHaveLength(0)
  })
})

describe("a token whose session is gone", () => {
  it("is refused, even though the signature still verifies", async () => {
    const context = await createTestServer()
    const { token } = await signIn(context)
    const session = required(context.db.sessions()[0], "session")

    await context.db.delete({
      table: "sessions",
      where: { tokenHash: session.tokenHash }
    })

    // The token still verifies — it is the row its `sid` names that is gone.
    await expect(
      context.authServer.deleteUser({ token })
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

    await context.authServer.sendSignInCode({ email: "ada@example.com" })
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
      context.authServer.updateUser({ headers: new Headers(), name: "Ada" })
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
        cookies: refreshCookieFor(refreshToken)
      })
    )
    const { token } = (await minted.json()) as { token: string }

    // No cookie, no request — the shape a custom API has after reading its own
    // Authorization header, or a service handed a token some other way.
    const updated = await context.authServer.updateUser({ token, name: "Ada" })

    expect(updated.name).toBe("Ada")
  })

  it("refuses an unreadable token when there is no cookie to fall back to", async () => {
    const { authServer } = await createTestServer()

    await expect(
      authServer.updateUser({ token: "forged.not.real", name: "Ada" })
    ).rejects.toThrow()
  })

  it("serves every authenticated callable from the token alone", async () => {
    const context = await createTestServer({
      user: { deleteFreshWindow: "1h" }
    })
    const { token } = await signIn(context)
    const { authServer } = context

    const updated = await authServer.updateUser({ token, name: "Ada" })
    expect(updated.name).toBe("Ada")
    expect(updated.email).toBe("ada@example.com")

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

    const updated = await context.authServer.updateUser({ token, name: "Ada" })

    expect(updated.email).toBe("ada@example.com")
  })
})
