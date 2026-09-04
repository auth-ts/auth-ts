import { describe, expect, it, vi } from "vitest"
import { createTestServer } from "../helpers/create-test-server"
import {
  readRefreshCookie,
  readSetCookies,
  refreshCookieFor,
  refreshEntryOf,
  request
} from "../helpers/request"
import { required } from "../helpers/required"

describe("verification code sign-in over HTTP", () => {
  it("signs a new user in end to end", async () => {
    const { auth, sentCodes, db } = await createTestServer()

    const sendResponse = await auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "Ada@Example.com" }
      })
    )
    expect(sendResponse.status).toBe(200)

    const sent = required(sentCodes[0], "sent code")
    expect(sent.destination).toBe("ada@example.com")
    expect(db.users()).toHaveLength(0)

    const verifyResponse = await auth.handler(
      request("POST", "/api/auth/sign-in/code", {
        body: { email: "ada@example.com", code: sent.code }
      })
    )
    expect(verifyResponse.status).toBe(200)

    const body = (await verifyResponse.json()) as {
      user: { email: string; type: string }
      token: string
    }
    expect(body.user.email).toBe("ada@example.com")
    expect(body.user.type).toBe("user")
    expect(await auth.verifyToken(body.token)).toBeTruthy()

    // The access token crosses in the body; the refresh token never does.
    const cookie = readRefreshCookie(verifyResponse)
    expect(cookie?.attributes).toContain("HttpOnly")
    expect(JSON.stringify(body)).not.toContain(cookie?.value ?? "impossible")
  })

  it("answers 200 for an unknown address, so nothing can be enumerated", async () => {
    const { auth, db } = await createTestServer()

    const response = await auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "stranger@example.com" }
      })
    )

    expect(response.status).toBe(200)
    expect(db.users()).toHaveLength(0)
  })

  it("rejects a wrong code with the standard envelope", async () => {
    const { auth, sentCodes } = await createTestServer()
    await auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    const sent = required(sentCodes[0], "sent code")
    const wrongCode = sent.code === "000000" ? "111111" : "000000"

    const response = await auth.handler(
      request("POST", "/api/auth/sign-in/code", {
        body: { email: "ada@example.com", code: wrongCode }
      })
    )

    expect(response.status).toBe(401)
    const body = (await response.json()) as {
      name: string
      code: string
      message: string
    }
    // `name` + `message` make the body a complete structural `Error`, so a raw
    // fetch caller can throw it into anything typed `Error` without wrapping.
    expect(body.name).toBe("AuthError")
    expect(body.code).toBe("invalidCode")
    expect(body.message.length).toBeGreaterThan(0)
    expect(body.message).not.toContain("ada@example.com")
  })

  it("returns 429 with Retry-After and a cooldown code on a rapid resend", async () => {
    const { auth, sentCodes } = await createTestServer()
    await auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )

    const response = await auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("60")

    const body = (await response.json()) as {
      code: string
      retryAfter: number
      message: string
    }
    expect(body.code).toBe("cooldown")
    expect(body.retryAfter).toBe(60)
    expect(body.message).toContain("60")
    expect(sentCodes).toHaveLength(1)
  })

  it("localizes the message while keeping the code stable", async () => {
    const { auth } = await createTestServer({
      localization: {
        defaultLocale: "en",
        messages: { de: { cooldown: "Bitte warte {retryAfter} Sekunden." } }
      }
    })
    await auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )

    const response = await auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" },
        headers: { "accept-language": "de-AT,de;q=0.9" }
      })
    )

    const body = (await response.json()) as {
      code: string
      message: string
    }
    expect(body.code).toBe("cooldown")
    expect(body.message).toBe("Bitte warte 60 Sekunden.")
  })

  it("passes the resolved locale through to the sender", async () => {
    const { auth, sentCodes } = await createTestServer({
      localization: { defaultLocale: "en", messages: { de: {} } }
    })

    await auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" },
        headers: { "accept-language": "de" }
      })
    )

    expect(required(sentCodes[0], "sent code").locale).toBe("de")
  })
})

describe("what a session records about proving identity", () => {
  it("names an emailed code otp, which is the registered value for one", async () => {
    const { auth, sentCodes, db } = await createTestServer()

    await auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    const verified = await auth.handler(
      request("POST", "/api/auth/sign-in/code", {
        body: {
          email: "ada@example.com",
          code: required(sentCodes.at(-1), "sent code").code
        }
      })
    )

    expect(db.sessions()[0]?.amr).toEqual(["otp"])

    // And it reaches the token, which is the thing a policy reads.
    const { token } = (await verified.json()) as { token: string }
    expect((await auth.verifyToken(token))?.amr).toEqual(["otp"])
  })

  it("names a texted code sms, which the registry distinguishes", async () => {
    const codes: string[] = []
    const { auth, db } = await createTestServer({
      sms: { sendCode: ({ code }) => void codes.push(code) }
    })

    await auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { phoneNumber: "+15555550123" }
      })
    )
    await auth.handler(
      request("POST", "/api/auth/sign-in/code", {
        body: {
          phoneNumber: "+15555550123",
          code: required(codes.at(-1), "sent code")
        }
      })
    )

    expect(db.sessions()[0]?.amr).toEqual(["sms"])
  })
})

describe("token and user endpoints", () => {
  const signIn = async () => {
    const context = await createTestServer()
    await context.auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    const sent = required(context.sentCodes[0], "sent code")
    const verifyResponse = await context.auth.handler(
      request("POST", "/api/auth/sign-in/code", {
        body: { email: "ada@example.com", code: sent.code }
      })
    )
    const refreshToken = required(
      readRefreshCookie(verifyResponse),
      "refresh cookie"
    ).value
    const { token } = (await verifyResponse.json()) as { token: string }

    return { ...context, refreshToken, token }
  }

  it("exchanges the cookie for a token, and returns the user with it", async () => {
    const { auth, refreshToken } = await signIn()

    const response = await auth.handler(
      request("GET", "/api/auth/token", {
        cookies: refreshCookieFor(refreshToken)
      })
    )
    const body = (await response.json()) as {
      token: string
      user: { email: string }
    }

    expect(response.status).toBe(200)
    expect(body.user.email).toBe("ada@example.com")
    expect((await auth.verifyToken(body.token))?.role).toBe("authenticated")
  })

  it("refuses every other endpoint the cookie alone", async () => {
    const { auth, refreshToken } = await signIn()
    const cookies = refreshCookieFor(refreshToken)

    for (const [method, path] of [
      ["POST", "/api/auth/user"],
      ["DELETE", "/api/auth/user"],
      ["POST", "/api/auth/user/send-delete-code"]
    ] as const) {
      const response = await auth.handler(request(method, path, { cookies }))

      expect(response.status).toBe(401)
    }
  })

  it("401s the user endpoint without a cookie", async () => {
    const { auth } = await createTestServer()
    const response = await auth.handler(
      request("POST", "/api/auth/user", { body: { name: "Ada" } })
    )

    expect(response.status).toBe(401)
    expect(((await response.json()) as { code: string }).code).toBe(
      "unauthenticated"
    )
  })

  it("updates name, leaves omitted fields alone, and rejects identity fields", async () => {
    const { auth, token } = await signIn()

    await auth.handler(
      request("POST", "/api/auth/user", {
        token,
        body: { name: "Ada", image: "https://img.example/a.png" }
      })
    )
    await auth.handler(
      request("POST", "/api/auth/user", { token, body: { name: "Ada L" } })
    )
    const read = await auth.handler(
      request("POST", "/api/auth/user", { token, body: { name: "Ada L" } })
    )
    const body = (await read.json()) as { name: string; image: string }

    expect(body.name).toBe("Ada L")
    expect(body.image).toBe("https://img.example/a.png")

    for (const rejected of [
      { email: "new@example.com" },
      { type: "admin" },
      { unknownField: 1 }
    ]) {
      const response = await auth.handler(
        request("POST", "/api/auth/user", { token, body: rejected })
      )
      expect(response.status).toBe(400)
      expect(((await response.json()) as { code: string }).code).toBe(
        "invalidField"
      )
    }
  })

  it("signs out locally and clears the cookie", async () => {
    const { auth, refreshToken, token } = await signIn()

    const response = await auth.handler(
      request("POST", "/api/auth/sign-out", {
        cookies: refreshCookieFor(refreshToken),
        token
      })
    )

    expect(response.status).toBe(204)
    const cleared = readSetCookies(response)
    expect(
      required(refreshEntryOf(cleared), "cleared cookie").attributes
    ).toContain("Max-Age=0")
    // The hint goes with it, or the next page load asks a question it already
    // knows the answer to.
    expect(
      required(cleared.get("auth-ts.hint"), "cleared hint").attributes
    ).toContain("Max-Age=0")

    const afterSignOut = await auth.handler(
      request("GET", "/api/auth/token", {
        cookies: refreshCookieFor(refreshToken)
      })
    )
    expect(afterSignOut.status).toBe(200)
    expect(await afterSignOut.json()).toBeNull()
  })
})

describe("jwks and discovery", () => {
  const jwks = {
    keys: [
      { kty: "RSA", kid: "k1", n: "AQ", e: "AQAB", alg: "RS256", use: "sig" }
    ]
  }

  it("has no jwks endpoint unless a document is configured", async () => {
    const { auth } = await createTestServer()

    expect((await auth.handler(request("GET", "/api/auth/jwks"))).status).toBe(
      404
    )
    expect(
      (await auth.handler(request("GET", "/api/auth/jwks.json"))).status
    ).toBe(404)
  })

  it("serves a configured jwks.json as given", async () => {
    const { auth } = await createTestServer({ jwks: { json: jwks } })
    const response = await auth.handler(request("GET", "/api/auth/jwks"))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(jwks)
  })

  it("advertises the public-folder jwks.json unless told otherwise", async () => {
    const discoveryOf = async (
      overrides: Parameters<typeof createTestServer>[0]
    ) => {
      const { auth } = await createTestServer({
        baseURL: "https://app.example.com",
        ...overrides
      })
      const response = await auth.handler(
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
    const { auth, sentCodes } = await createTestServer({
      baseURL: "https://app.example.com"
    })
    const response = await auth.handler(
      request("GET", "/api/auth/.well-known/openid-configuration")
    )
    const body = (await response.json()) as { issuer: string; jwks_uri: string }

    expect(body.issuer).toBe("https://app.example.com/api/auth")

    await auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    const verifyResponse = await auth.handler(
      request("POST", "/api/auth/sign-in/code", {
        body: {
          email: "ada@example.com",
          code: required(sentCodes[0], "sent").code
        }
      })
    )
    const { token } = (await verifyResponse.json()) as { token: string }

    expect(auth.decodeToken(token)?.claims.iss).toBe(body.issuer)
  })

  it("404s discovery when no baseURL is configured", async () => {
    const { auth } = await createTestServer()
    const response = await auth.handler(
      request("GET", "/api/auth/.well-known/openid-configuration")
    )

    expect(response.status).toBe(404)
  })
})

describe("GET /token", () => {
  it("answers null and retires the credential a stranger presented", async () => {
    const { auth } = await createTestServer({ multiUser: true })

    const response = await auth.handler(
      request("GET", "/api/auth/token", {
        cookies: refreshCookieFor("a token no session was ever issued for")
      })
    )
    const cookies = readSetCookies(response)

    // 200, not 401: nobody signed in is the answer to this question, and only
    // an answer may carry the cookies that stop it being asked again.
    expect(response.status).toBe(200)
    expect(await response.json()).toBeNull()
    expect(required(refreshEntryOf(cookies), "refresh").attributes).toContain(
      "Max-Age=0"
    )
    expect(required(cookies.get("auth-ts.hint"), "hint").attributes).toContain(
      "Max-Age=0"
    )
    // The accounts cookie is not this endpoint's to retire: the sessions it
    // lists are live, and none of them is what was just refused.
    expect(cookies.get("auth-ts.refresh.accounts")).toBeUndefined()
  })

  it("says out rather than nothing when the app is on another origin", async () => {
    // Cross-origin, a hint that never arrived is indistinguishable from one
    // that says no — so the refusal has to be stated, not implied by absence.
    const { auth } = await createTestServer({
      trustedOrigins: ["https://app.example.com"],
      // Named rather than derived: the hint has to be readable where it was
      // asked from, and only the deployment knows where that is.
      cookie: { hintDomain: "example.com" }
    })

    const response = await auth.handler(
      request("GET", "/api/auth/token", {
        origin: "https://api.example.com",
        headers: { origin: "https://app.example.com" }
      })
    )
    const hint = required(readSetCookies(response).get("auth-ts.hint"), "hint")

    expect(hint.value).toBe("out")
    expect(hint.attributes).toContain("Domain=example.com")
    expect(hint.attributes).not.toContain("Max-Age=0")
  })

  it("slides the session it read through", async () => {
    const { auth, sentCodes, db } = await createTestServer()

    await auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    const signIn = await auth.handler(
      request("POST", "/api/auth/sign-in/code", {
        body: {
          email: "ada@example.com",
          code: required(sentCodes[0], "sent code").code
        }
      })
    )
    const cookies = {
      ...refreshCookieFor(
        required(readRefreshCookie(signIn), "refresh cookie").value
      )
    }
    const before = required(db.sessions()[0], "session")

    // The columns carry whole milliseconds, so a read in the same tick would
    // land on the same value and prove nothing.
    await new Promise((resolve) => setTimeout(resolve, 5))
    const read = await auth.handler(
      request("GET", "/api/auth/token", { cookies })
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

describe("where a token comes from", () => {
  const signedIn = async () => {
    const context = await createTestServer()
    await context.auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    const verified = await context.auth.handler(
      request("POST", "/api/auth/sign-in/code", {
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
        ...refreshCookieFor(
          required(readRefreshCookie(verified), "refresh cookie").value
        )
      }
    }
  }

  it("hands one back with the sign-in, so the first render costs no refresh", async () => {
    const { context, token } = await signedIn()

    expect(await context.auth.verifyToken(token)).toBeTruthy()
  })

  it("mints one at /token, and nowhere else", async () => {
    const { context, cookies } = await signedIn()

    const refreshed = await context.auth.handler(
      request("GET", "/api/auth/token", { cookies })
    )
    expect(((await refreshed.json()) as { token: string }).token).toEqual(
      expect.any(String)
    )

    // No endpoint hands a token back on the side any more, so there is no
    // second answer to "where did this token come from".
    const read = await context.auth.handler(
      request("POST", "/api/auth/user", { cookies, body: { name: "Ada" } })
    )
    expect(read.status).toBe(401)
  })

  it("refuses a token that does not verify rather than repairing it", async () => {
    const { context, cookies } = await signedIn()

    const response = await context.auth.handler(
      request("POST", "/api/auth/user", {
        cookies,
        body: { name: "Ada" },
        headers: { authorization: "Bearer not.a.token" }
      })
    )

    // A cookie on the request buys nothing: self-healing here would mean every
    // endpoint could slide a session and sign a token.
    expect(response.status).toBe(401)
  })

  it("ignores an Authorization header on /token, since a spent token is why callers are there", async () => {
    const { context, cookies } = await signedIn()

    const response = await context.auth.handler(
      request("GET", "/api/auth/token", {
        cookies,
        headers: { authorization: "Bearer not.a.token" }
      })
    )

    expect(response.status).toBe(200)
  })

  it("reads the caller from the token, touching no session at all", async () => {
    const { context, token, cookies } = await signedIn()
    const update = vi.spyOn(context.db, "update")

    const response = await context.auth.handler(
      request("POST", "/api/auth/user", {
        cookies,
        token,
        body: { name: "Ada" }
      })
    )

    expect(response.status).toBe(200)
    expect(
      update.mock.calls.filter(([input]) => input.table === "sessions")
    ).toHaveLength(0)
  })

  it("touches the session on /token and on nothing else", async () => {
    const { context, cookies, token } = await signedIn()
    const update = vi.spyOn(context.db, "update")

    await context.auth.handler(
      request("POST", "/api/auth/user", { token, body: { name: "Ada" } })
    )
    expect(
      update.mock.calls.filter(([input]) => input.table === "sessions")
    ).toHaveLength(0)

    await context.auth.handler(request("GET", "/api/auth/token", { cookies }))
    expect(
      update.mock.calls.filter(([input]) => input.table === "sessions")
    ).toHaveLength(1)
  })
})
