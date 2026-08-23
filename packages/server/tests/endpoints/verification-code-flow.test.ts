import { describe, expect, it, vi } from "vitest"
import { createTestServer } from "../helpers/create-test-server"
import { readSetCookies, request } from "../helpers/request"
import { required } from "../helpers/required"

describe("verification code sign-in over HTTP", () => {
  it("signs a new user in end to end", async () => {
    const { authServer, sentCodes, db } = await createTestServer()

    const sendResponse = await authServer.handler(
      request("POST", "/api/auth/send-code", {
        body: { email: "Ada@Example.com" }
      })
    )
    expect(sendResponse.status).toBe(200)

    const sent = required(sentCodes[0], "sent code")
    expect(sent.destination).toBe("ada@example.com")
    expect(db.users()).toHaveLength(0)

    const verifyResponse = await authServer.handler(
      request("POST", "/api/auth/verify-code", {
        body: { email: "ada@example.com", code: sent.code }
      })
    )
    expect(verifyResponse.status).toBe(200)

    const body = (await verifyResponse.json()) as {
      token: string
      user: { email: string; type: string }
    }
    expect(body.user.email).toBe("ada@example.com")
    expect(body.user.type).toBe("user")
    expect(body.token).toBeTruthy()

    const cookie = readSetCookies(verifyResponse).get("auth-ts.refresh")
    expect(cookie?.attributes).toContain("HttpOnly")
    expect(JSON.stringify(body)).not.toContain(cookie?.value ?? "impossible")
  })

  it("answers 200 for an unknown address, so nothing can be enumerated", async () => {
    const { authServer, db } = await createTestServer()

    const response = await authServer.handler(
      request("POST", "/api/auth/send-code", {
        body: { email: "stranger@example.com" }
      })
    )

    expect(response.status).toBe(200)
    expect(db.users()).toHaveLength(0)
  })

  it("rejects a wrong code with the standard envelope", async () => {
    const { authServer, sentCodes } = await createTestServer()
    await authServer.handler(
      request("POST", "/api/auth/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    const sent = required(sentCodes[0], "sent code")
    const wrongCode = sent.code === "000000" ? "111111" : "000000"

    const response = await authServer.handler(
      request("POST", "/api/auth/verify-code", {
        body: { email: "ada@example.com", code: wrongCode }
      })
    )

    expect(response.status).toBe(401)
    const body = (await response.json()) as {
      error: { code: string; message: string }
    }
    expect(body.error.code).toBe("invalidCode")
    expect(body.error.message.length).toBeGreaterThan(0)
    expect(body.error.message).not.toContain("ada@example.com")
  })

  it("returns 429 with Retry-After and a cooldown code on a rapid resend", async () => {
    const { authServer, sentCodes } = await createTestServer()
    await authServer.handler(
      request("POST", "/api/auth/send-code", {
        body: { email: "ada@example.com" }
      })
    )

    const response = await authServer.handler(
      request("POST", "/api/auth/send-code", {
        body: { email: "ada@example.com" }
      })
    )

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("60")

    const body = (await response.json()) as {
      error: { code: string; retryAfter: number; message: string }
    }
    expect(body.error.code).toBe("cooldown")
    expect(body.error.retryAfter).toBe(60)
    expect(body.error.message).toContain("60")
    expect(sentCodes).toHaveLength(1)
  })

  it("localizes the message while keeping the code stable", async () => {
    const { authServer } = await createTestServer({
      localization: {
        defaultLocale: "en",
        messages: { de: { cooldown: "Bitte warte {retryAfter} Sekunden." } }
      }
    })
    await authServer.handler(
      request("POST", "/api/auth/send-code", {
        body: { email: "ada@example.com" }
      })
    )

    const response = await authServer.handler(
      request("POST", "/api/auth/send-code", {
        body: { email: "ada@example.com" },
        headers: { "accept-language": "de-AT,de;q=0.9" }
      })
    )

    const body = (await response.json()) as {
      error: { code: string; message: string }
    }
    expect(body.error.code).toBe("cooldown")
    expect(body.error.message).toBe("Bitte warte 60 Sekunden.")
  })

  it("passes the resolved locale through to the sender", async () => {
    const { authServer, sentCodes } = await createTestServer({
      localization: { defaultLocale: "en", messages: { de: {} } }
    })

    await authServer.handler(
      request("POST", "/api/auth/send-code", {
        body: { email: "ada@example.com" },
        headers: { "accept-language": "de" }
      })
    )

    expect(required(sentCodes[0], "sent code").locale).toBe("de")
  })
})

describe("token and user endpoints", () => {
  const signIn = async () => {
    const context = await createTestServer()
    await context.authServer.handler(
      request("POST", "/api/auth/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    const sent = required(context.sentCodes[0], "sent code")
    const verifyResponse = await context.authServer.handler(
      request("POST", "/api/auth/verify-code", {
        body: { email: "ada@example.com", code: sent.code }
      })
    )
    const refreshToken = required(
      readSetCookies(verifyResponse).get("auth-ts.refresh"),
      "refresh cookie"
    ).value

    return { ...context, refreshToken }
  }

  it("refreshes an access token from the cookie", async () => {
    const { authServer, refreshToken } = await signIn()

    const response = await authServer.handler(
      request("GET", "/api/auth/user", {
        cookies: { "auth-ts.refresh": refreshToken }
      })
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      token: string
      user: { email: string }
    }
    expect(body.user.email).toBe("ada@example.com")

    const claims = await authServer.verifyToken(body.token)
    expect(claims?.role).toBe("authenticated")
  })

  it("never returns the stored token hash — every column but that one", async () => {
    // The hash at rest is the whole point of storing sha256(token) instead of the
    // token. Handing it back on every refresh would undo that, and it was.
    const { authServer, refreshToken, db } = await signIn()

    const response = await authServer.handler(
      request("GET", "/api/auth/user", {
        cookies: { "auth-ts.refresh": refreshToken }
      })
    )
    const body = (await response.json()) as { session: Record<string, unknown> }
    const storedHash = required(db.sessions()[0], "session").tokenHash

    expect(JSON.stringify(body)).not.toContain("tokenHash")
    expect(JSON.stringify(body)).not.toContain(storedHash)
    // Exact key set, so a new AuthSession column cannot widen this silently.
    // No userAgent or ipAddress: this sign-in carried neither header, and the
    // stamp writes only what it was given.
    expect(Object.keys(body.session).sort()).toEqual([
      "createdAt",
      "expiresAt",
      "id",
      "updatedAt",
      "userId"
    ])
  })

  it("401s the user endpoint without a cookie", async () => {
    const { authServer } = await createTestServer()
    const response = await authServer.handler(request("GET", "/api/auth/user"))

    expect(response.status).toBe(401)
    expect(
      ((await response.json()) as { error: { code: string } }).error.code
    ).toBe("unauthenticated")
  })

  it("reads the current user and 401s without a session", async () => {
    const { authServer, refreshToken } = await signIn()

    const signedIn = await authServer.handler(
      request("GET", "/api/auth/user", {
        cookies: { "auth-ts.refresh": refreshToken }
      })
    )
    expect(
      ((await signedIn.json()) as { user: { email: string } }).user.email
    ).toBe("ada@example.com")

    const signedOut = await authServer.handler(request("GET", "/api/auth/user"))
    expect(signedOut.status).toBe(401)
  })

  it("updates name, leaves omitted fields alone, and rejects identity fields", async () => {
    const { authServer, refreshToken } = await signIn()
    const cookies = { "auth-ts.refresh": refreshToken }

    await authServer.handler(
      request("POST", "/api/auth/user", {
        cookies,
        body: { name: "Ada", imageURL: "https://img.example/a.png" }
      })
    )
    await authServer.handler(
      request("POST", "/api/auth/user", { cookies, body: { name: "Ada L" } })
    )
    const read = await authServer.handler(
      request("GET", "/api/auth/user", { cookies })
    )
    const body = (await read.json()) as {
      user: { name: string; imageURL: string }
    }

    expect(body.user.name).toBe("Ada L")
    expect(body.user.imageURL).toBe("https://img.example/a.png")

    for (const rejected of [
      { email: "new@example.com" },
      { type: "admin" },
      { unknownField: 1 }
    ]) {
      const response = await authServer.handler(
        request("POST", "/api/auth/user", { cookies, body: rejected })
      )
      expect(response.status).toBe(400)
      expect(
        ((await response.json()) as { error: { code: string } }).error.code
      ).toBe("invalidField")
    }
  })

  it("lists the whole session row, less the token hash", async () => {
    const { authServer, refreshToken } = await signIn()
    const cookies = { "auth-ts.refresh": refreshToken }

    const response = await authServer.handler(
      request("GET", "/api/auth/sessions", { cookies })
    )
    const body = (await response.json()) as {
      sessions: Array<Record<string, unknown>>
    }
    const [session] = body.sessions

    expect(JSON.stringify(body)).not.toContain("tokenHash")
    // Everything else is the caller's own row: `updatedAt` is when the device
    // was last used, and `id` is how they tell which one they are on.
    expect(Object.keys(session ?? {}).sort()).toEqual([
      "createdAt",
      "expiresAt",
      "id",
      "updatedAt",
      "userId"
    ])
  })

  it("signs out locally and clears the cookie", async () => {
    const { authServer, refreshToken } = await signIn()

    const response = await authServer.handler(
      request("POST", "/api/auth/sign-out", {
        cookies: { "auth-ts.refresh": refreshToken }
      })
    )

    expect(response.status).toBe(204)
    expect(
      required(
        readSetCookies(response).get("auth-ts.refresh"),
        "cleared cookie"
      ).attributes
    ).toContain("Max-Age=0")

    const afterSignOut = await authServer.handler(
      request("GET", "/api/auth/user", {
        cookies: { "auth-ts.refresh": refreshToken }
      })
    )
    expect(afterSignOut.status).toBe(401)
  })
})

describe("jwks and discovery", () => {
  const jwks = {
    keys: [
      { kty: "RSA", kid: "k1", n: "AQ", e: "AQAB", alg: "RS256", use: "sig" }
    ]
  }

  it("has no jwks endpoint unless a document is configured", async () => {
    const { authServer } = await createTestServer()

    expect(
      (await authServer.handler(request("GET", "/api/auth/jwks"))).status
    ).toBe(404)
    expect(
      (await authServer.handler(request("GET", "/api/auth/jwks.json"))).status
    ).toBe(404)
  })

  it("serves a configured jwks.json as given", async () => {
    const { authServer } = await createTestServer({ jwks: { json: jwks } })
    const response = await authServer.handler(request("GET", "/api/auth/jwks"))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(jwks)
  })

  it("advertises the public-folder jwks.json unless told otherwise", async () => {
    const discoveryOf = async (
      overrides: Parameters<typeof createTestServer>[0]
    ) => {
      const { authServer } = await createTestServer({
        baseURL: "https://app.example.com",
        ...overrides
      })
      const response = await authServer.handler(
        request("GET", "/api/auth/.well-known/openid-configuration")
      )
      return (await response.json()) as { jwks_uri: string }
    }

    expect((await discoveryOf({})).jwks_uri).toBe(
      "https://app.example.com/jwks.json"
    )
    expect((await discoveryOf({ jwks: { json: jwks } })).jwks_uri).toBe(
      "https://app.example.com/api/auth/jwks"
    )
    expect(
      (
        await discoveryOf({
          jwks: { json: jwks, url: "https://cdn.example.com/keys.json" }
        })
      ).jwks_uri
    ).toBe("https://cdn.example.com/keys.json")
  })

  it("advertises an issuer that matches the token's iss claim", async () => {
    const { authServer, sentCodes } = await createTestServer({
      baseURL: "https://app.example.com"
    })
    const response = await authServer.handler(
      request("GET", "/api/auth/.well-known/openid-configuration")
    )
    const body = (await response.json()) as { issuer: string; jwks_uri: string }

    expect(body.issuer).toBe("https://app.example.com/api/auth")

    await authServer.handler(
      request("POST", "/api/auth/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    const verifyResponse = await authServer.handler(
      request("POST", "/api/auth/verify-code", {
        body: {
          email: "ada@example.com",
          code: required(sentCodes[0], "sent").code
        }
      })
    )
    const { token } = (await verifyResponse.json()) as {
      token: string
    }

    expect(authServer.decodeToken(token)?.claims.iss).toBe(body.issuer)
  })

  it("404s discovery when no baseURL is configured", async () => {
    const { authServer } = await createTestServer()
    const response = await authServer.handler(
      request("GET", "/api/auth/.well-known/openid-configuration")
    )

    expect(response.status).toBe(404)
  })
})

describe("GET /user", () => {
  it("slides the session it read through", async () => {
    const { authServer, sentCodes, db } = await createTestServer()

    await authServer.handler(
      request("POST", "/api/auth/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    const signIn = await authServer.handler(
      request("POST", "/api/auth/verify-code", {
        body: {
          email: "ada@example.com",
          code: required(sentCodes[0], "sent code").code
        }
      })
    )
    const cookies = {
      "auth-ts.refresh": required(
        readSetCookies(signIn).get("auth-ts.refresh"),
        "refresh cookie"
      ).value
    }
    const before = required(db.sessions()[0], "session")

    // The columns carry whole milliseconds, so a read in the same tick would
    // land on the same value and prove nothing.
    await new Promise((resolve) => setTimeout(resolve, 5))
    const read = await authServer.handler(
      request("GET", "/api/auth/user", { cookies })
    )
    expect(read.status).toBe(200)

    const after = required(db.sessions()[0], "session")
    expect(after.expiresAt.getTime()).toBeGreaterThan(
      before.expiresAt.getTime()
    )
    expect(after.updatedAt.getTime()).toBeGreaterThan(
      before.updatedAt.getTime()
    )
    expect(after.createdAt.getTime()).toBe(before.createdAt.getTime())
  })
})

describe("the token GET /user hands back", () => {
  const signInFor = async () => {
    const context = await createTestServer()
    await context.authServer.handler(
      request("POST", "/api/auth/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    const verified = await context.authServer.handler(
      request("POST", "/api/auth/verify-code", {
        body: {
          email: "ada@example.com",
          code: required(context.sentCodes[0], "sent code").code
        }
      })
    )
    const { token } = (await verified.json()) as { token: string }

    return {
      context,
      token,
      cookies: {
        "auth-ts.refresh": required(
          readSetCookies(verified).get("auth-ts.refresh"),
          "refresh cookie"
        ).value
      }
    }
  }

  it("mints one when the caller has none", async () => {
    const { context, cookies } = await signInFor()

    const response = await context.authServer.handler(
      request("GET", "/api/auth/user", { cookies })
    )
    const body = (await response.json()) as { token?: string }

    expect(body.token).toEqual(expect.any(String))
  })

  it("sends none back when the caller already holds a live one", async () => {
    const { context, cookies, token } = await signInFor()

    const response = await context.authServer.handler(
      request("GET", "/api/auth/user", {
        cookies,
        headers: { authorization: `Bearer ${token}` }
      })
    )
    const body = (await response.json()) as {
      token?: string
      user: { email: string }
    }

    // The point of the exercise: a sync socket holding this JWT is not handed a
    // new one every time a tab regains focus.
    expect(body.token).toBeUndefined()
    expect(body.user.email).toBe("ada@example.com")
  })

  it("mints one when the type claim no longer matches the row", async () => {
    const { context, cookies, token } = await signInFor()
    const [stored] = context.db.users()
    await context.db.update({
      table: "users",
      where: { id: required(stored, "user").id },
      values: { type: "admin" }
    })

    const response = await context.authServer.handler(
      request("GET", "/api/auth/user", {
        cookies,
        headers: { authorization: `Bearer ${token}` }
      })
    )
    const body = (await response.json()) as { token?: string }

    // Otherwise a promotion or demotion would wait out the token's lifetime,
    // and `type` is the claim policies match on.
    expect(body.token).toEqual(expect.any(String))
  })

  it("mints one when what was presented does not verify", async () => {
    const { context, cookies } = await signInFor()

    const response = await context.authServer.handler(
      request("GET", "/api/auth/user", {
        cookies,
        headers: { authorization: "Bearer not.a.token" }
      })
    )

    expect(((await response.json()) as { token?: string }).token).toEqual(
      expect.any(String)
    )
  })
})

describe("authenticating from the access token", () => {
  const signedIn = async () => {
    const context = await createTestServer()
    await context.authServer.handler(
      request("POST", "/api/auth/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    const verified = await context.authServer.handler(
      request("POST", "/api/auth/verify-code", {
        body: {
          email: "ada@example.com",
          code: required(context.sentCodes[0], "sent code").code
        }
      })
    )
    const { token } = (await verified.json()) as { token: string }

    return {
      context,
      token,
      cookies: {
        "auth-ts.refresh": required(
          readSetCookies(verified).get("auth-ts.refresh"),
          "refresh cookie"
        ).value
      }
    }
  }

  it("reads the caller from the token, without looking the session up", async () => {
    const { context, token, cookies } = await signedIn()
    const update = vi.spyOn(context.db, "update")

    const response = await context.authServer.handler(
      request("GET", "/api/auth/sessions", {
        cookies,
        headers: { authorization: `Bearer ${token}` }
      })
    )
    const body = (await response.json()) as { sessions: Array<{ id: string }> }

    expect(response.status).toBe(200)
    expect(body.sessions).toHaveLength(1)
    // The session was never resolved, which is the whole point.
    expect(
      update.mock.calls.filter(([input]) => input.table === "sessions")
    ).toHaveLength(0)
  })

  it("falls back to the cookie when no token rides along", async () => {
    const { context, cookies } = await signedIn()

    const response = await context.authServer.handler(
      request("GET", "/api/auth/sessions", { cookies })
    )

    expect(response.status).toBe(200)
  })

  it("refuses a token that does not verify, rather than falling back", async () => {
    const { context, cookies } = await signedIn()

    const response = await context.authServer.handler(
      request("GET", "/api/auth/sessions", {
        cookies,
        headers: { authorization: "Bearer forged.not.real" }
      })
    )

    // The cookie is perfectly good. A forged token is still an error, because
    // quietly ignoring it would make forgery indistinguishable from slowness.
    expect(response.status).toBe(401)
  })
})
