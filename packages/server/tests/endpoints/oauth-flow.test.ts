import { afterEach, describe, expect, it, vi } from "vitest"
import { createTestServer } from "../helpers/create-test-server.ts"
import { readSetCookies, request } from "../helpers/request.ts"
import { required } from "../helpers/required.ts"
import { stubGitHub } from "../helpers/stub-provider-network.ts"

const OAUTH_OPTIONS = {
  baseURL: "https://app.example.com",
  providers: {
    github: { clientId: "client-id", clientSecret: "client-secret" }
  }
}

const verifiedEmails = (email: string) => [
  { email, primary: true, verified: true }
]

afterEach(() => {
  vi.restoreAllMocks()
})

/** Runs the start endpoint and returns the state cookie the callback will need. */
async function startSignIn(
  authServer: Awaited<ReturnType<typeof createTestServer>>["authServer"],
  query = ""
) {
  const response = await authServer.handler(
    request("GET", `/api/auth/sign-in/github${query}`)
  )
  const stateCookie = required(
    readSetCookies(response).get("auth-ts.state"),
    "state cookie"
  ).value
  const state = (JSON.parse(stateCookie) as { state: string }).state

  return { response, stateCookie, state }
}

describe("oauth start", () => {
  it("redirects to the provider with state and the configured redirect_uri", async () => {
    const { authServer } = await createTestServer(OAUTH_OPTIONS)
    const { response, state } = await startSignIn(authServer)

    expect(response.status).toBe(302)
    const location = new URL(
      required(response.headers.get("location"), "location")
    )
    expect(location.origin + location.pathname).toBe(
      "https://github.com/login/oauth/authorize"
    )
    expect(location.searchParams.get("state")).toBe(state)
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/api/auth/callback/github"
    )
    expect(location.searchParams.get("scope")).toBe("read:user user:email")
  })

  it("scopes the state cookie to the callback path only", async () => {
    const { authServer } = await createTestServer(OAUTH_OPTIONS)
    const { response } = await startSignIn(authServer)

    expect(
      required(readSetCookies(response).get("auth-ts.state"), "state")
        .attributes
    ).toContain("Path=/api/auth/callback/github")
  })

  it("keeps a same-origin redirect and discards anything else", async () => {
    const { authServer } = await createTestServer(OAUTH_OPTIONS)

    const safe = await startSignIn(authServer, "?redirect=%2Fdashboard")
    expect(
      (JSON.parse(safe.stateCookie) as { redirect: string }).redirect
    ).toBe("/dashboard")

    for (const hostile of [
      "https%3A%2F%2Fevil.example",
      "%2F%2Fevil.example"
    ]) {
      const blocked = await startSignIn(authServer, `?redirect=${hostile}`)
      expect(
        (JSON.parse(blocked.stateCookie) as { redirect: string }).redirect
      ).toBe("/")
    }
  })

  it("404s an unconfigured provider and the reserved guest name", async () => {
    const { authServer } = await createTestServer(OAUTH_OPTIONS)

    expect(
      (await authServer.handler(request("GET", "/api/auth/sign-in/google")))
        .status
    ).toBe(404)
    expect(
      (await authServer.handler(request("GET", "/api/auth/sign-in/guest")))
        .status
    ).toBe(404)
  })
})

describe("oauth callback", () => {
  it("signs in, sets the session cookie, and returns to the validated path", async () => {
    const { authServer, db } = await createTestServer(OAUTH_OPTIONS)
    const { stateCookie, state } = await startSignIn(
      authServer,
      "?redirect=%2Fdashboard"
    )
    stubGitHub({
      id: 4242,
      name: "Ada",
      emails: verifiedEmails("ada@example.com")
    })

    const response = await authServer.handler(
      request("GET", `/api/auth/callback/github?code=abc&state=${state}`, {
        cookies: { "auth-ts.state": stateCookie }
      })
    )

    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe("/dashboard")
    expect(readSetCookies(response).has("auth-ts.refresh")).toBe(true)

    const [user] = db.users()
    expect(user?.email).toBe("ada@example.com")
    expect(user?.name).toBe("Ada")
    expect(user?.type).toBe("user")
  })

  it("gives the provider a deadline and renders a page when it is not met", async () => {
    const { authServer } = await createTestServer(OAUTH_OPTIONS)
    const { stateCookie, state } = await startSignIn(authServer)
    const signals: unknown[] = []
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      signals.push(init?.signal)
      // What fetch throws when the signal from AbortSignal.timeout fires.
      throw new DOMException("The operation was aborted", "TimeoutError")
    })

    const response = await authServer.handler(
      request("GET", `/api/auth/callback/github?code=abc&state=${state}`, {
        cookies: { "auth-ts.state": stateCookie }
      })
    )

    expect(signals).toHaveLength(1)
    expect(signals[0]).toBeInstanceOf(AbortSignal)
    expect(response.status).toBe(502)
    expect(response.headers.get("content-type")).toContain("text/html")
    expect(await response.text()).toContain("did not respond")
    // The state cookie is cleared whichever way the callback ends.
    expect(
      required(readSetCookies(response).get("auth-ts.state"), "state").value
    ).toBe("")
  })

  it("renders a page, not a JSON envelope, when the provider rejects the code", async () => {
    const { authServer } = await createTestServer(OAUTH_OPTIONS)
    const { stateCookie, state } = await startSignIn(authServer)
    stubGitHub({ id: 4242, accessToken: null })

    const response = await authServer.handler(
      request("GET", `/api/auth/callback/github?code=bad&state=${state}`, {
        cookies: { "auth-ts.state": stateCookie }
      })
    )

    expect(response.status).toBe(401)
    expect(response.headers.get("content-type")).toContain("text/html")
  })

  it("merges a guest into the account a provider identity is already linked to, without moving the link", async () => {
    const context = await createTestServer({ ...OAUTH_OPTIONS, guest: true })
    const { authServer, db } = context
    const owner = await db.upsertUser({
      email: "owner@example.com",
      type: "user"
    })
    await db.upsertConnection({
      userId: owner.id,
      provider: "github",
      providerAccountId: "4242"
    })
    // A different account holds the email GitHub now reports — the exact
    // situation where resolving by email alone would re-point the link.
    const other = await db.upsertUser({
      email: "other@example.com",
      type: "user"
    })
    const guestResponse = await authServer.handler(
      request("POST", "/api/auth/sign-in/guest")
    )
    const guestRefresh = required(
      readSetCookies(guestResponse).get("auth-ts.refresh"),
      "refresh"
    ).value
    const guest = ((await guestResponse.json()) as { user: { id: string } })
      .user
    const { stateCookie, state } = await startSignIn(authServer)
    stubGitHub({ id: 4242, emails: verifiedEmails("other@example.com") })

    const response = await authServer.handler(
      request("GET", `/api/auth/callback/github?code=abc&state=${state}`, {
        cookies: {
          "auth-ts.state": stateCookie,
          "auth-ts.refresh": guestRefresh
        }
      })
    )

    expect(response.status).toBe(302)
    expect(
      (
        await db.getConnection({
          provider: "github",
          providerAccountId: "4242"
        })
      )?.userId
    ).toBe(owner.id)
    expect((await db.getUser({ id: guest.id }))?.primaryUserId).toBe(owner.id)
    expect(await db.listConnections({ userId: other.id })).toEqual([])

    const whoami = await authServer.handler(
      request("GET", "/api/auth/user", {
        cookies: {
          "auth-ts.refresh": required(
            readSetCookies(response).get("auth-ts.refresh"),
            "refresh"
          ).value
        }
      })
    )
    expect(((await whoami.json()) as { user: { id: string } }).user.id).toBe(
      owner.id
    )
  })

  it("upgrades a guest in place for a new provider identity and records the link", async () => {
    const context = await createTestServer({ ...OAUTH_OPTIONS, guest: true })
    const { authServer, db } = context
    const guestResponse = await authServer.handler(
      request("POST", "/api/auth/sign-in/guest")
    )
    const guestRefresh = required(
      readSetCookies(guestResponse).get("auth-ts.refresh"),
      "refresh"
    ).value
    const guest = ((await guestResponse.json()) as { user: { id: string } })
      .user
    const { stateCookie, state } = await startSignIn(authServer)
    stubGitHub({
      id: 5555,
      name: "Ada",
      emails: verifiedEmails("ada@example.com")
    })

    const response = await authServer.handler(
      request("GET", `/api/auth/callback/github?code=abc&state=${state}`, {
        cookies: {
          "auth-ts.state": stateCookie,
          "auth-ts.refresh": guestRefresh
        }
      })
    )

    expect(response.status).toBe(302)
    const upgraded = await db.getUser({ id: guest.id })
    expect(upgraded?.type).toBe("user")
    expect(upgraded?.email).toBe("ada@example.com")
    expect(upgraded?.primaryUserId).toBeNull()
    expect(
      (
        await db.getConnection({
          provider: "github",
          providerAccountId: "5555"
        })
      )?.userId
    ).toBe(guest.id)
    expect(db.users()).toHaveLength(1)
  })

  it("rejects a mismatched state, which is the CSRF guard", async () => {
    const { authServer, db } = await createTestServer(OAUTH_OPTIONS)
    const { stateCookie } = await startSignIn(authServer)
    stubGitHub({ id: 4242, emails: verifiedEmails("ada@example.com") })

    const response = await authServer.handler(
      request(
        "GET",
        "/api/auth/callback/github?code=abc&state=attacker-supplied",
        {
          cookies: { "auth-ts.state": stateCookie }
        }
      )
    )

    expect(response.status).toBe(401)
    expect(db.users()).toHaveLength(0)
  })

  it("rejects a callback with no state cookie at all", async () => {
    const { authServer, db } = await createTestServer(OAUTH_OPTIONS)
    stubGitHub({ id: 4242, emails: verifiedEmails("ada@example.com") })

    const response = await authServer.handler(
      request("GET", "/api/auth/callback/github?code=abc&state=anything")
    )

    expect(response.status).toBe(401)
    expect(db.users()).toHaveLength(0)
  })

  it("refuses an unverified email, which would otherwise be account takeover", async () => {
    const { authServer, db } = await createTestServer(OAUTH_OPTIONS)
    const { stateCookie, state } = await startSignIn(authServer)
    stubGitHub({
      id: 4242,
      emails: [{ email: "victim@example.com", primary: true, verified: false }]
    })

    const response = await authServer.handler(
      request("GET", `/api/auth/callback/github?code=abc&state=${state}`, {
        cookies: { "auth-ts.state": stateCookie }
      })
    )

    expect(response.status).toBe(403)
    expect(db.users()).toHaveLength(0)
  })

  it("refuses a verified but non-primary email", async () => {
    const { authServer, db } = await createTestServer(OAUTH_OPTIONS)
    const { stateCookie, state } = await startSignIn(authServer)
    stubGitHub({
      id: 4242,
      emails: [{ email: "victim@example.com", primary: false, verified: true }]
    })

    const response = await authServer.handler(
      request("GET", `/api/auth/callback/github?code=abc&state=${state}`, {
        cookies: { "auth-ts.state": stateCookie }
      })
    )

    expect(response.status).toBe(403)
    expect(db.users()).toHaveLength(0)
  })

  it("matches on the provider account id even after the email changed there", async () => {
    const { authServer, db } = await createTestServer(OAUTH_OPTIONS)

    const first = await startSignIn(authServer)
    stubGitHub({ id: 4242, emails: verifiedEmails("ada@example.com") })
    await authServer.handler(
      request(
        "GET",
        `/api/auth/callback/github?code=abc&state=${first.state}`,
        {
          cookies: { "auth-ts.state": first.stateCookie }
        }
      )
    )
    expect(db.users()).toHaveLength(1)

    vi.restoreAllMocks()
    const second = await startSignIn(authServer)
    stubGitHub({
      id: 4242,
      emails: verifiedEmails("ada.lovelace@newdomain.example")
    })
    await authServer.handler(
      request(
        "GET",
        `/api/auth/callback/github?code=abc&state=${second.state}`,
        {
          cookies: { "auth-ts.state": second.stateCookie }
        }
      )
    )

    // Same person, not a duplicate account.
    expect(db.users()).toHaveLength(1)
  })

  it("links a verified email to an account that already signed up with a code", async () => {
    const { authServer, db, sentCodes } = await createTestServer(OAUTH_OPTIONS)
    await authServer.handler(
      request("POST", "/api/auth/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    await authServer.handler(
      request("POST", "/api/auth/verify-code", {
        body: {
          email: "ada@example.com",
          code: required(sentCodes[0], "code").code
        }
      })
    )
    expect(db.users()).toHaveLength(1)

    const { stateCookie, state } = await startSignIn(authServer)
    stubGitHub({
      id: 4242,
      name: "Ada",
      avatarURL: "https://img.example/a.png",
      emails: verifiedEmails("ada@example.com")
    })
    await authServer.handler(
      request("GET", `/api/auth/callback/github?code=abc&state=${state}`, {
        cookies: { "auth-ts.state": stateCookie }
      })
    )

    expect(db.users()).toHaveLength(1)
    // Merge semantics: the code user gains a name and picture, no second account.
    expect(db.users()[0]?.name).toBe("Ada")
    expect(db.users()[0]?.imageURL).toBe("https://img.example/a.png")
  })
})

describe("connect and disconnect", () => {
  const signInWithCode = async (
    context: Awaited<ReturnType<typeof createTestServer>>
  ) => {
    await context.authServer.handler(
      request("POST", "/api/auth/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    const verifyResponse = await context.authServer.handler(
      request("POST", "/api/auth/verify-code", {
        body: {
          email: "ada@example.com",
          code: required(context.sentCodes.at(-1), "code").code
        }
      })
    )

    return required(
      readSetCookies(verifyResponse).get("auth-ts.refresh"),
      "refresh"
    ).value
  }

  it("requires a session to start a link", async () => {
    const { authServer } = await createTestServer(OAUTH_OPTIONS)
    expect(
      (await authServer.handler(request("GET", "/api/auth/connect/github")))
        .status
    ).toBe(401)
  })

  it("links a provider to the current user without creating one", async () => {
    const context = await createTestServer(OAUTH_OPTIONS)
    const refreshToken = await signInWithCode(context)
    const cookies = { "auth-ts.refresh": refreshToken }

    const startResponse = await context.authServer.handler(
      request("GET", "/api/auth/connect/github", { cookies })
    )
    const stateCookie = required(
      readSetCookies(startResponse).get("auth-ts.state"),
      "state"
    ).value
    const { state } = JSON.parse(stateCookie) as { state: string }

    stubGitHub({ id: 4242, emails: verifiedEmails("different@example.com") })
    const callbackResponse = await context.authServer.handler(
      request("GET", `/api/auth/callback/github?code=abc&state=${state}`, {
        cookies: { ...cookies, "auth-ts.state": stateCookie }
      })
    )

    expect(callbackResponse.status).toBe(302)
    expect(context.db.users()).toHaveLength(1)

    const listed = await context.authServer.handler(
      request("GET", "/api/auth/connections", { cookies })
    )
    const body = (await listed.json()) as {
      connections: Array<{ provider: string }>
    }
    expect(body.connections.map((connection) => connection.provider)).toEqual([
      "github"
    ])
  })

  it("rejects a connect callback arriving without the original session", async () => {
    const context = await createTestServer(OAUTH_OPTIONS)
    const refreshToken = await signInWithCode(context)

    const startResponse = await context.authServer.handler(
      request("GET", "/api/auth/connect/github", {
        cookies: { "auth-ts.refresh": refreshToken }
      })
    )
    const stateCookie = required(
      readSetCookies(startResponse).get("auth-ts.state"),
      "state"
    ).value
    const { state } = JSON.parse(stateCookie) as { state: string }

    stubGitHub({ id: 4242, emails: verifiedEmails("attacker@example.com") })
    // The victim follows the link without the session that started it.
    const callbackResponse = await context.authServer.handler(
      request("GET", `/api/auth/callback/github?code=abc&state=${state}`, {
        cookies: { "auth-ts.state": stateCookie }
      })
    )

    expect(callbackResponse.status).toBe(401)
    expect(
      await context.db.listConnections({
        userId: required(context.db.users()[0], "user").id
      })
    ).toEqual([])
  })

  it("refuses to re-point a provider identity already linked elsewhere", async () => {
    const context = await createTestServer(OAUTH_OPTIONS)
    const firstUser = await context.db.upsertUser({
      email: "first@example.com"
    })
    await context.db.upsertConnection({
      userId: firstUser.id,
      provider: "github",
      providerAccountId: "4242"
    })

    const refreshToken = await signInWithCode(context)
    const cookies = { "auth-ts.refresh": refreshToken }
    const startResponse = await context.authServer.handler(
      request("GET", "/api/auth/connect/github", { cookies })
    )
    const stateCookie = required(
      readSetCookies(startResponse).get("auth-ts.state"),
      "state"
    ).value
    const { state } = JSON.parse(stateCookie) as { state: string }

    stubGitHub({ id: 4242, emails: verifiedEmails("ada@example.com") })
    const callbackResponse = await context.authServer.handler(
      request("GET", `/api/auth/callback/github?code=abc&state=${state}`, {
        cookies: { ...cookies, "auth-ts.state": stateCookie }
      })
    )

    expect(callbackResponse.status).toBe(409)
    const connection = await context.db.getConnection({
      provider: "github",
      providerAccountId: "4242"
    })
    expect(connection?.userId).toBe(firstUser.id)
  })

  it("unlinks a provider when another sign-in method remains", async () => {
    const context = await createTestServer(OAUTH_OPTIONS)
    const refreshToken = await signInWithCode(context)
    const cookies = { "auth-ts.refresh": refreshToken }
    const user = required(context.db.users()[0], "user")
    await context.db.upsertConnection({
      userId: user.id,
      provider: "github",
      providerAccountId: "4242"
    })

    const response = await context.authServer.handler(
      request("DELETE", "/api/auth/connections/github", { cookies })
    )

    expect(response.status).toBe(204)
    expect(await context.db.listConnections({ userId: user.id })).toEqual([])
  })

  it("refuses to remove the only remaining sign-in method", async () => {
    const context = await createTestServer(OAUTH_OPTIONS)
    const { authServer, db } = context

    // A user who only ever signed in with GitHub: no email, no phone.
    const user = await db.upsertUser({ type: "guest" })
    await db.upsertUser({ id: user.id, type: "user" })
    await db.upsertConnection({
      userId: user.id,
      provider: "github",
      providerAccountId: "4242"
    })

    const startResponse = await authServer.handler(
      request("GET", "/api/auth/sign-in/github")
    )
    const stateCookie = required(
      readSetCookies(startResponse).get("auth-ts.state"),
      "state"
    ).value
    const { state } = JSON.parse(stateCookie) as { state: string }
    stubGitHub({ id: 4242, emails: [] })

    const callbackResponse = await authServer.handler(
      request("GET", `/api/auth/callback/github?code=abc&state=${state}`, {
        cookies: { "auth-ts.state": stateCookie }
      })
    )
    const refreshToken = required(
      readSetCookies(callbackResponse).get("auth-ts.refresh"),
      "refresh"
    ).value

    const response = await authServer.handler(
      request("DELETE", "/api/auth/connections/github", {
        cookies: { "auth-ts.refresh": refreshToken }
      })
    )

    expect(response.status).toBe(409)
    expect(
      ((await response.json()) as { error: { code: string } }).error.code
    ).toBe("lastSignInMethod")
  })
})
