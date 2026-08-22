import { afterEach, describe, expect, it, vi } from "vitest"
import { codeChallengeS256 } from "../../src/oauth/pkce"
import { createTestServer } from "../helpers/create-test-server"
import { readSetCookies, request } from "../helpers/request"
import { required } from "../helpers/required"
import { insertUser, selectRow, selectRows } from "../helpers/rows"
import { decodeState, forgeState } from "../helpers/state-cookie"
import { stubGitHub, stubGoogle } from "../helpers/stub-provider-network"

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
  const state = decodeState(stateCookie).state

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

  it("sends a PKCE S256 challenge derived from the verifier it signed into the state", async () => {
    const { authServer } = await createTestServer(OAUTH_OPTIONS)
    const { response, stateCookie } = await startSignIn(authServer)
    const location = new URL(
      required(response.headers.get("location"), "location")
    )
    const payload = decodeState(stateCookie)

    expect(payload.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(location.searchParams.get("code_challenge_method")).toBe("S256")
    expect(location.searchParams.get("code_challenge")).toBe(
      await codeChallengeS256(payload.codeVerifier)
    )
    // The verifier itself never travels through the browser.
    expect(location.href).not.toContain(payload.codeVerifier)
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
    expect(decodeState(safe.stateCookie).redirect).toBe("/dashboard")

    for (const hostile of [
      "https%3A%2F%2Fevil.example",
      "%2F%2Fevil.example"
    ]) {
      const blocked = await startSignIn(authServer, `?redirect=${hostile}`)
      expect(decodeState(blocked.stateCookie).redirect).toBe("/")
    }
  })

  it("answers 400, not 500, when additionalFields is not JSON", async () => {
    const { authServer } = await createTestServer(OAUTH_OPTIONS)

    const response = await authServer.handler(
      request("GET", "/api/auth/sign-in/github?additionalFields=%7Bnope")
    )

    expect(response.status).toBe(400)
    expect(
      ((await response.json()) as { error: { code: string } }).error.code
    ).toBe("invalidField")
  })

  it("404s an unconfigured provider, the reserved guest name, and prototype keys", async () => {
    const { authServer } = await createTestServer(OAUTH_OPTIONS)

    for (const name of [
      "google",
      "guest",
      "constructor",
      "__proto__",
      "toString"
    ]) {
      for (const route of ["sign-in", "callback"]) {
        expect(
          (
            await authServer.handler(
              request("GET", `/api/auth/${route}/${name}`)
            )
          ).status,
          `${route}/${name}`
        ).toBe(404)
      }
    }
  })
})

describe("oauth redirect_uri origin", () => {
  const NO_BASE_URL = {
    providers: {
      github: { clientId: "client-id", clientSecret: "client-secret" }
    }
  }

  /** The `redirect_uri` the authorize URL was built with. */
  async function redirectURIOf(
    authServer: Awaited<ReturnType<typeof createTestServer>>["authServer"],
    options: Parameters<typeof request>[2] = {}
  ) {
    const response = await authServer.handler(
      request("GET", "/api/auth/sign-in/github", options)
    )
    const location = new URL(
      required(response.headers.get("location"), "location")
    )
    return required(location.searchParams.get("redirect_uri"), "redirect_uri")
  }

  it("derives the origin from the request when no baseURL is configured", async () => {
    const { authServer } = await createTestServer(NO_BASE_URL)

    expect(await redirectURIOf(authServer)).toBe(
      "https://app.example.com/api/auth/callback/github"
    )
    expect(
      await redirectURIOf(authServer, { origin: "http://localhost:3000" })
    ).toBe("http://localhost:3000/api/auth/callback/github")
  })

  it("prefers the forwarded host and protocol, which is the origin behind a proxy", async () => {
    // The runtime sees the internal URL; only these headers carry the origin
    // the browser actually used, so a proxied deployment needs no configuration.
    const { authServer } = await createTestServer(NO_BASE_URL)

    expect(
      await redirectURIOf(authServer, {
        origin: "http://10.0.0.7:8080",
        headers: {
          "x-forwarded-host": "app.example.com",
          "x-forwarded-proto": "https"
        }
      })
    ).toBe("https://app.example.com/api/auth/callback/github")
  })

  it("takes the leftmost forwarded entry and keeps only an origin", async () => {
    const { authServer } = await createTestServer(NO_BASE_URL)

    expect(
      await redirectURIOf(authServer, {
        origin: "http://10.0.0.7:8080",
        headers: {
          // Each hop appends, so the browser's host is the leftmost entry, and
          // anything beyond a host in it is normalized away.
          "x-forwarded-host": "app.example.com/evil, edge.internal",
          "x-forwarded-proto": "https, http"
        }
      })
    ).toBe("https://app.example.com/api/auth/callback/github")
  })

  it("pins the origin when baseURL is configured, whatever the request says", async () => {
    const { authServer } = await createTestServer(OAUTH_OPTIONS)

    expect(
      await redirectURIOf(authServer, {
        origin: "http://10.0.0.7:8080",
        headers: { "x-forwarded-host": "attacker.example.com" }
      })
    ).toBe("https://app.example.com/api/auth/callback/github")
  })

  it("exchanges the code with the same redirect_uri it authorized with", async () => {
    // The provider records the URI from the authorize request and refuses the
    // exchange unless the identical string comes back, so the two derivations
    // have to agree.
    const { authServer } = await createTestServer(NO_BASE_URL)
    const proxied = {
      origin: "http://10.0.0.7:8080",
      headers: {
        "x-forwarded-host": "app.example.com",
        "x-forwarded-proto": "https"
      }
    }

    const start = await authServer.handler(
      request("GET", "/api/auth/sign-in/github", proxied)
    )
    const location = new URL(
      required(start.headers.get("location"), "location")
    )
    const stateCookie = required(
      readSetCookies(start).get("auth-ts.state"),
      "state cookie"
    ).value
    const { state } = decodeState(stateCookie)

    const fetchSpy = stubGitHub({
      id: 1,
      emails: verifiedEmails("ada@example.com")
    })
    const response = await authServer.handler(
      request("GET", `/api/auth/callback/github?code=abc&state=${state}`, {
        ...proxied,
        cookies: { "auth-ts.state": stateCookie }
      })
    )

    expect(response.status).toBe(302)
    const exchange = required(
      fetchSpy.mock.calls.find(([url]) =>
        String(url).includes("login/oauth/access_token")
      ),
      "token exchange"
    )
    const body = JSON.parse(String(exchange[1]?.body)) as {
      redirect_uri: string
    }
    expect(body.redirect_uri).toBe(location.searchParams.get("redirect_uri"))
    expect(body.redirect_uri).toBe(
      "https://app.example.com/api/auth/callback/github"
    )
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

  it("sends the PKCE verifier from the state cookie to the token endpoint", async () => {
    const { authServer } = await createTestServer(OAUTH_OPTIONS)
    const { stateCookie, state } = await startSignIn(authServer)
    const fetchSpy = stubGitHub({
      id: 4242,
      emails: verifiedEmails("ada@example.com")
    })

    await authServer.handler(
      request("GET", `/api/auth/callback/github?code=abc&state=${state}`, {
        cookies: { "auth-ts.state": stateCookie }
      })
    )

    const tokenCall = fetchSpy.mock.calls.find(([input]) =>
      String(input).includes("login/oauth/access_token")
    )
    const tokenBody = JSON.parse(
      String(required(tokenCall, "token call")[1]?.body)
    ) as { code_verifier?: string }
    expect(tokenBody.code_verifier).toBe(decodeState(stateCookie).codeVerifier)
  })

  it("refuses a state that has aged out, whatever the cookie jar thinks", async () => {
    // The cookie's Max-Age is a browser courtesy. The payload's issuedAt is
    // signed, so a genuine cookie replayed from a jar that never expires
    // anything is refused on the server's clock.
    const { authServer, db } = await createTestServer(OAUTH_OPTIONS)
    const { stateCookie, state } = await startSignIn(authServer)
    stubGitHub({ id: 4242, emails: verifiedEmails("ada@example.com") })
    const payload = decodeState(stateCookie)

    for (const stale of [
      { ...payload, issuedAt: Date.now() - 11 * 60_000 },
      { ...payload, issuedAt: Date.now() + 5 * 60_000 },
      { ...payload, issuedAt: "yesterday" as unknown as number },
      (({ issuedAt: _issuedAt, ...rest }) => rest)(payload) as typeof payload
    ]) {
      const response = await authServer.handler(
        request("GET", `/api/auth/callback/github?code=abc&state=${state}`, {
          cookies: { "auth-ts.state": await forgeState(stale) }
        })
      )
      expect(response.status, JSON.stringify(stale.issuedAt)).toBe(401)
    }
    expect(db.users()).toHaveLength(0)

    // Within the tolerance, a clock slightly ahead is fine.
    const slightlyAhead = await authServer.handler(
      request("GET", `/api/auth/callback/github?code=abc&state=${state}`, {
        cookies: {
          "auth-ts.state": await forgeState({
            ...payload,
            issuedAt: Date.now() + 30_000
          })
        }
      })
    )
    expect(slightlyAhead.status).toBe(302)
  })

  it("refuses a genuine state that lacks a verifier or nonce", async () => {
    const { authServer } = await createTestServer(OAUTH_OPTIONS)
    const { stateCookie, state } = await startSignIn(authServer)
    stubGitHub({ id: 4242, emails: verifiedEmails("ada@example.com") })
    const payload = decodeState(stateCookie)

    for (const broken of [
      { ...payload, codeVerifier: "" },
      { ...payload, nonce: "" }
    ]) {
      const response = await authServer.handler(
        request("GET", `/api/auth/callback/github?code=abc&state=${state}`, {
          cookies: { "auth-ts.state": await forgeState(broken) }
        })
      )
      expect(response.status).toBe(401)
    }
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

  it("reports a provider 5xx as unavailable, not as a refused sign-in", async () => {
    const { authServer, db } = await createTestServer(OAUTH_OPTIONS)

    for (const status of [
      { token: 503 },
      { profile: 502 },
      { emails: 500 },
      // Throttling is "try again", not "you are not who you say you are".
      { token: 429 },
      { emails: 429 }
    ] as const) {
      const { stateCookie, state } = await startSignIn(authServer)
      stubGitHub({
        id: 4242,
        emails: verifiedEmails("ada@example.com"),
        status
      })

      const response = await authServer.handler(
        request("GET", `/api/auth/callback/github?code=abc&state=${state}`, {
          cookies: { "auth-ts.state": stateCookie }
        })
      )

      expect(response.status, JSON.stringify(status)).toBe(502)
      expect(await response.text()).toContain("did not respond")
    }
    expect(db.users()).toHaveLength(0)

    // GitHub answers its rate limits with 403, not 429: primary limits carry
    // x-ratelimit-remaining: 0, secondary ones retry-after. Both are throttling.
    const throttlingHeaders: Array<Record<string, string>> = [
      { "x-ratelimit-remaining": "0" },
      { "retry-after": "60" }
    ]
    for (const headers of throttlingHeaders) {
      const { stateCookie, state } = await startSignIn(authServer)
      stubGitHub({
        id: 4242,
        status: { profile: 403 },
        headers: { profile: headers }
      })
      const throttled = await authServer.handler(
        request("GET", `/api/auth/callback/github?code=abc&state=${state}`, {
          cookies: { "auth-ts.state": stateCookie }
        })
      )
      expect(throttled.status, JSON.stringify(headers)).toBe(502)
    }

    // A plain 403 on the emails endpoint is the scope not being granted, which
    // is the "no verified address" refusal — still a 403, not an outage. The
    // budget header GitHub sends on every response is not a throttling signal
    // unless it reads zero.
    const { stateCookie, state } = await startSignIn(authServer)
    stubGitHub({
      id: 4242,
      status: { emails: 403 },
      headers: { emails: { "x-ratelimit-remaining": "4999" } }
    })
    const refused = await authServer.handler(
      request("GET", `/api/auth/callback/github?code=abc&state=${state}`, {
        cookies: { "auth-ts.state": stateCookie }
      })
    )
    expect(refused.status).toBe(403)
  })

  it("merges a guest into the account a provider identity is already linked to, without moving the link", async () => {
    const context = await createTestServer({ ...OAUTH_OPTIONS, guest: true })
    const { authServer, db } = context
    const owner = await insertUser(db, { email: "owner@example.com" })
    await db.insert({
      table: "connections",
      values: {
        userId: owner.id,
        provider: "github",
        providerAccountId: "4242",
        email: null
      }
    })
    // A different account holds the email GitHub now reports — the exact
    // situation where resolving by email alone would re-point the link.
    const other = await insertUser(db, { email: "other@example.com" })
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
        await selectRow(db, "connections", {
          provider: "github",
          providerAccountId: "4242"
        })
      )?.userId
    ).toBe(owner.id)
    expect(
      (await selectRow(db, "users", { id: guest.id }))?.primaryUserId
    ).toBe(owner.id)
    expect(await selectRows(db, "connections", { userId: other.id })).toEqual(
      []
    )

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
    // The guest session was replaced by the callback, not left live beside it.
    expect(
      (
        await authServer.handler(
          request("GET", "/api/auth/user", {
            cookies: { "auth-ts.refresh": guestRefresh }
          })
        )
      ).status
    ).toBe(401)
  })

  it("applies sign-up additionalFields when a guest is upgraded in place", async () => {
    const context = await createTestServer({
      ...OAUTH_OPTIONS,
      guest: true,
      user: { additionalFields: { plan: "string" } }
    })
    const { authServer } = context
    const guestResponse = await authServer.handler(
      request("POST", "/api/auth/sign-in/guest")
    )
    const guestRefresh = required(
      readSetCookies(guestResponse).get("auth-ts.refresh"),
      "guest refresh"
    ).value
    const guest = ((await guestResponse.json()) as { user: { id: string } })
      .user

    const { stateCookie, state } = await startSignIn(
      authServer,
      `?additionalFields=${encodeURIComponent(JSON.stringify({ plan: "pro" }))}`
    )
    stubGitHub({ id: 4242, emails: verifiedEmails("ada@example.com") })

    const response = await authServer.handler(
      request("GET", `/api/auth/callback/github?code=abc&state=${state}`, {
        cookies: {
          "auth-ts.state": stateCookie,
          "auth-ts.refresh": guestRefresh
        }
      })
    )

    expect(response.status).toBe(302)
    const upgraded = (await selectRow(context.db, "users", {
      id: guest.id
    })) as unknown as Record<string, unknown>
    expect(upgraded.type).toBe("user")
    expect(upgraded.email).toBe("ada@example.com")
    expect(upgraded.plan).toBe("pro")
  })

  it("treats a guest's connect as a sign-in: merges into the linked account rather than refusing", async () => {
    const context = await createTestServer({ ...OAUTH_OPTIONS, guest: true })
    const { authServer, db } = context
    const owner = await insertUser(db, { email: "owner@example.com" })
    await db.insert({
      table: "connections",
      values: {
        userId: owner.id,
        provider: "github",
        providerAccountId: "4242",
        email: null
      }
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
    const startResponse = await authServer.handler(
      request("GET", "/api/auth/connect/github", {
        cookies: { "auth-ts.refresh": guestRefresh }
      })
    )
    const stateCookie = required(
      readSetCookies(startResponse).get("auth-ts.state"),
      "state"
    ).value
    const { state } = decodeState(stateCookie)
    stubGitHub({ id: 4242, emails: verifiedEmails("owner@example.com") })

    const response = await authServer.handler(
      request("GET", `/api/auth/callback/github?code=abc&state=${state}`, {
        cookies: {
          "auth-ts.state": stateCookie,
          "auth-ts.refresh": guestRefresh
        }
      })
    )

    // Not the connect branch's 409: a session is issued for the owner.
    expect(response.status).toBe(302)
    expect(readSetCookies(response).has("auth-ts.refresh")).toBe(true)
    expect(
      (await selectRow(db, "users", { id: guest.id }))?.primaryUserId
    ).toBe(owner.id)
    expect(
      (
        await selectRow(db, "connections", {
          provider: "github",
          providerAccountId: "4242"
        })
      )?.userId
    ).toBe(owner.id)
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
    const upgraded = await selectRow(db, "users", { id: guest.id })
    expect(upgraded?.type).toBe("user")
    expect(upgraded?.email).toBe("ada@example.com")
    expect(upgraded?.primaryUserId).toBeNull()
    expect(
      (
        await selectRow(db, "connections", {
          provider: "github",
          providerAccountId: "5555"
        })
      )?.userId
    ).toBe(guest.id)
    expect(db.users()).toHaveLength(1)
  })

  it("revalidates additionalFields from the state cookie instead of trusting them", async () => {
    // The signature proves the payload came from this server, not that the
    // fields are still declared. Any path that signs a payload without running
    // /sign-in/:provider's validation would ride an undeclared column into user
    // creation, so the callback checks again where the write happens.
    const { authServer, db } = await createTestServer({
      ...OAUTH_OPTIONS,
      user: { additionalFields: { plan: "string" } }
    })
    const { stateCookie, state } = await startSignIn(authServer)
    stubGitHub({ id: 4242, emails: verifiedEmails("ada@example.com") })

    // Signed with the real secret, so only the revalidation can catch it.
    const tampered = await forgeState({
      ...decodeState(stateCookie),
      additionalFields: { plan: "pro", type: "admin" }
    })
    const response = await authServer.handler(
      request("GET", `/api/auth/callback/github?code=abc&state=${state}`, {
        cookies: { "auth-ts.state": tampered }
      })
    )

    expect(response.status).toBe(400)
    expect(db.users()).toHaveLength(0)
    // The state cookie is cleared whichever way the callback ends.
    expect(
      required(readSetCookies(response).get("auth-ts.state"), "state").value
    ).toBe("")

    // And a declared field still comes through untouched.
    const clean = await startSignIn(authServer)
    const accepted = await authServer.handler(
      request(
        "GET",
        `/api/auth/callback/github?code=abc&state=${clean.state}`,
        {
          cookies: {
            "auth-ts.state": await forgeState({
              ...decodeState(clean.stateCookie),
              additionalFields: { plan: "pro" }
            })
          }
        }
      )
    )
    expect(accepted.status).toBe(302)
    expect(db.users()[0]).toMatchObject({ plan: "pro" })
  })

  it("rejects a state cookie that this server did not sign", async () => {
    const { authServer, db } = await createTestServer(OAUTH_OPTIONS)
    const { stateCookie, state } = await startSignIn(authServer)
    stubGitHub({ id: 4242, emails: verifiedEmails("ada@example.com") })
    const payload = decodeState(stateCookie)

    const forgeries = [
      // Edited in place: the payload no longer matches the signature.
      `${stateCookie.startsWith("A") ? "B" : "A"}${stateCookie.slice(1)}`,
      // The open-redirect attempt: same state, hostile return path, signed
      // under some other key.
      await forgeState({ ...payload, redirect: "//evil.example" }, "not-it"),
      // The pre-signing shape, for anyone replaying an old cookie.
      JSON.stringify(payload),
      ""
    ]
    for (const forged of forgeries) {
      const response = await authServer.handler(
        request("GET", `/api/auth/callback/github?code=abc&state=${state}`, {
          cookies: { "auth-ts.state": forged }
        })
      )
      expect(response.status, JSON.stringify(forged)).toBe(401)
    }
    expect(db.users()).toHaveLength(0)
  })

  it("refuses a state cookie at a different provider's callback, even a genuine one", async () => {
    // Path scoping keeps a browser from sending this, but the writer the
    // signature defends against can plant a cookie at any path. The provider
    // is signed in, so a GitHub start cannot complete a Google callback.
    const { authServer, db } = await createTestServer({
      ...OAUTH_OPTIONS,
      providers: {
        ...OAUTH_OPTIONS.providers,
        google: { clientId: "client-id", clientSecret: "client-secret" }
      }
    })
    const { stateCookie, state } = await startSignIn(authServer)
    expect(decodeState(stateCookie).provider).toBe("github")

    const response = await authServer.handler(
      request("GET", `/api/auth/callback/google?code=abc&state=${state}`, {
        cookies: { "auth-ts.state": stateCookie }
      })
    )

    expect(response.status).toBe(401)
    expect(db.users()).toHaveLength(0)
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
    const { state } = decodeState(stateCookie)

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
    const { state } = decodeState(stateCookie)

    stubGitHub({ id: 4242, emails: verifiedEmails("attacker@example.com") })
    // The victim follows the link without the session that started it.
    const callbackResponse = await context.authServer.handler(
      request("GET", `/api/auth/callback/github?code=abc&state=${state}`, {
        cookies: { "auth-ts.state": stateCookie }
      })
    )

    expect(callbackResponse.status).toBe(401)
    expect(
      await selectRows(context.db, "connections", {
        userId: required(context.db.users()[0], "user").id
      })
    ).toEqual([])
  })

  it("refuses to re-point a provider identity already linked elsewhere", async () => {
    const context = await createTestServer(OAUTH_OPTIONS)
    const firstUser = await insertUser(context.db, {
      email: "first@example.com"
    })
    await context.db.insert({
      table: "connections",
      values: {
        userId: firstUser.id,
        provider: "github",
        providerAccountId: "4242",
        email: null
      }
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
    const { state } = decodeState(stateCookie)

    stubGitHub({ id: 4242, emails: verifiedEmails("ada@example.com") })
    const callbackResponse = await context.authServer.handler(
      request("GET", `/api/auth/callback/github?code=abc&state=${state}`, {
        cookies: { ...cookies, "auth-ts.state": stateCookie }
      })
    )

    expect(callbackResponse.status).toBe(409)
    const connection = await selectRow(context.db, "connections", {
      provider: "github",
      providerAccountId: "4242"
    })
    expect(connection?.userId).toBe(firstUser.id)
  })

  it("unlinks a provider", async () => {
    const context = await createTestServer(OAUTH_OPTIONS)
    const refreshToken = await signInWithCode(context)
    const cookies = { "auth-ts.refresh": refreshToken }
    const user = required(context.db.users()[0], "user")
    await context.db.insert({
      table: "connections",
      values: {
        userId: user.id,
        provider: "github",
        providerAccountId: "4242",
        email: null
      }
    })

    const response = await context.authServer.handler(
      request("DELETE", "/api/auth/connections/github", { cookies })
    )

    expect(response.status).toBe(204)
    expect(
      await selectRows(context.db, "connections", { userId: user.id })
    ).toEqual([])
  })
})

describe("google", () => {
  const GOOGLE_OPTIONS = {
    baseURL: "https://app.example.com",
    providers: {
      google: { clientId: "client-id", clientSecret: "client-secret" }
    }
  }

  /** Starts the flow and returns what the callback will need. */
  async function startGoogle(
    authServer: Awaited<ReturnType<typeof createTestServer>>["authServer"]
  ) {
    const response = await authServer.handler(
      request("GET", "/api/auth/sign-in/google")
    )
    const stateCookie = required(
      readSetCookies(response).get("auth-ts.state"),
      "state cookie"
    ).value
    return { stateCookie, state: decodeState(stateCookie).state }
  }

  async function callback(
    authServer: Awaited<ReturnType<typeof createTestServer>>["authServer"],
    identity: Parameters<typeof stubGoogle>[0]
  ) {
    const { stateCookie, state } = await startGoogle(authServer)
    // The fake Google echoes the nonce this flow asked for, as the real one
    // would — unless a test deliberately hands it a different one.
    stubGoogle({ nonce: decodeState(stateCookie).nonce, ...identity })
    return authServer.handler(
      request("GET", `/api/auth/callback/google?code=abc&state=${state}`, {
        cookies: { "auth-ts.state": stateCookie }
      })
    )
  }

  it("sends a PKCE challenge and a nonce, and requires the nonce back in the ID token", async () => {
    const { authServer } = await createTestServer(GOOGLE_OPTIONS)
    const start = await authServer.handler(
      request("GET", "/api/auth/sign-in/google")
    )
    const location = new URL(
      required(start.headers.get("location"), "location")
    )
    const stateCookie = required(
      readSetCookies(start).get("auth-ts.state"),
      "state cookie"
    ).value
    const payload = decodeState(stateCookie)

    expect(location.searchParams.get("code_challenge_method")).toBe("S256")
    expect(location.searchParams.get("code_challenge")).toBe(
      await codeChallengeS256(payload.codeVerifier)
    )
    expect(location.searchParams.get("nonce")).toBe(payload.nonce)

    const fetchSpy = stubGoogle({
      sub: "g-1",
      email: "ada@example.com",
      emailVerified: true,
      nonce: payload.nonce
    })
    const response = await authServer.handler(
      request(
        "GET",
        `/api/auth/callback/google?code=abc&state=${payload.state}`,
        { cookies: { "auth-ts.state": stateCookie } }
      )
    )
    expect(response.status).toBe(302)

    const tokenCall = fetchSpy.mock.calls.find(([input]) =>
      String(input).includes("oauth2.googleapis.com/token")
    )
    const tokenBody = new URLSearchParams(
      String(required(tokenCall, "token call")[1]?.body)
    )
    expect(tokenBody.get("code_verifier")).toBe(payload.codeVerifier)
  })

  it("refuses an ID token whose nonce is not this flow's", async () => {
    const { authServer, db } = await createTestServer(GOOGLE_OPTIONS)

    for (const nonce of ["someone-elses-flow", ""]) {
      const response = await callback(authServer, {
        sub: "g-1",
        email: "ada@example.com",
        emailVerified: true,
        nonce
      })
      expect(response.status, JSON.stringify(nonce)).toBe(401)
    }
    expect(db.users()).toHaveLength(0)
  })

  it("signs in with a verified ID token and takes only a verified email", async () => {
    const { authServer, db } = await createTestServer(GOOGLE_OPTIONS)

    const response = await callback(authServer, {
      sub: "g-1",
      email: "Ada@Example.com",
      emailVerified: true,
      name: "Ada",
      picture: "https://lh3.example/ada"
    })

    expect(response.status).toBe(302)
    expect(readSetCookies(response).has("auth-ts.refresh")).toBe(true)
    expect(db.users()[0]).toMatchObject({
      email: "ada@example.com",
      name: "Ada",
      imageURL: "https://lh3.example/ada"
    })
  })

  it("refuses an ID token that does not verify — wrong key, audience, issuer, expiry, or shape", async () => {
    const { authServer, db } = await createTestServer(GOOGLE_OPTIONS)

    // Each would have sailed through a decode-only check, and each is a
    // token Google did not issue to this client for use right now.
    for (const token of [
      { wrongKey: true },
      { audience: "someone-elses-client-id" },
      { issuer: "https://accounts.evil.example" },
      { expiresIn: -60 },
      { malformed: true },
      // Correctly signed but incomplete: jose only validates an exp it finds,
      // so without requiredClaims a token with none would live forever.
      { omit: ["exp"] },
      { omit: ["iat"] },
      { omit: ["sub"] }
    ] as const) {
      const response = await callback(authServer, {
        sub: "g-1",
        email: "ada@example.com",
        emailVerified: true,
        token
      })
      expect(response.status, JSON.stringify(token)).toBe(401)
    }
    expect(db.users()).toHaveLength(0)
  })

  it("drops an unverified email rather than trusting it", async () => {
    const { authServer, db } = await createTestServer(GOOGLE_OPTIONS)

    const response = await callback(authServer, {
      sub: "g-1",
      email: "victim@example.com",
      emailVerified: false
    })

    expect(response.status).toBe(403)
    expect(db.users()).toHaveLength(0)
  })

  it("reports an unreachable token endpoint as the provider being down", async () => {
    const { authServer, db } = await createTestServer(GOOGLE_OPTIONS)

    const response = await callback(authServer, {
      sub: "g-1",
      email: "ada@example.com",
      emailVerified: true,
      status: { token: 503 }
    })

    expect(response.status).toBe(502)
    expect(db.users()).toHaveLength(0)
  })

  it("reports an unreachable key set as the provider being down", async () => {
    // jose caches Google's keys at module level, so once any test in this file
    // has verified a token the endpoint is never consulted again — which is the
    // point in production. A fresh module instance is the only way to reach the
    // first-fetch failure path.
    vi.resetModules()
    const { google } = await import("../../src/oauth/providers/google")
    stubGoogle({ sub: "g-1", status: { jwks: 503 } })

    await expect(
      google.exchangeCode({
        credentials: { clientId: "client-id", clientSecret: "client-secret" },
        redirectURI: "https://app.example.com/api/auth/callback/google",
        code: "abc",
        codeVerifier: "verifier",
        nonce: "nonce",
        signal: AbortSignal.timeout(5_000)
      })
    ).rejects.toMatchObject({ code: "providerUnavailable", status: 502 })
  })
})
