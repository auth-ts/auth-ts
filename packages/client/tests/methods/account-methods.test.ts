import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createAuthClient } from "../../src/core/create-auth-client"
import type { FakeAuthServer } from "../helpers/fake-auth-server"
import { fakeAccessToken, fakeAuthServer } from "../helpers/fake-auth-server"

const user = { id: "user-1", email: "ada@example.com", type: "user" as const }
const other = {
  id: "user-2",
  email: "grace@example.com",
  type: "user" as const
}

let server: FakeAuthServer

beforeEach(() => {
  localStorage.clear()
  server = fakeAuthServer()
})

afterEach(() => {
  server.restore()
  vi.unstubAllGlobals()
})

describe("verifyCode", () => {
  it("primes the token and user without a second round-trip", async () => {
    server.on("POST", "/api/auth/verify-code", {
      body: { accessToken: fakeAccessToken(), user }
    })
    const client = createAuthClient()

    await client.verifyCode({ email: "ada@example.com", code: "123456" })

    expect(await client.getUser()).toMatchObject({ email: "ada@example.com" })
    expect(server.requests).toHaveLength(1)
  })
})

describe("sendCode", () => {
  it("passes the identifier through and reports a cooldown with its countdown", async () => {
    server.on("POST", "/api/auth/send-code", { body: { sent: true } })
    server.on("POST", "/api/auth/send-code", {
      status: 429,
      body: {
        error: { code: "cooldown", message: "Wait 60 seconds.", retryAfter: 60 }
      }
    })
    const client = createAuthClient()

    await client.sendCode({ email: "ada@example.com" })
    expect(server.requests[0]?.body).toEqual({ email: "ada@example.com" })

    await expect(
      client.sendCode({ email: "ada@example.com" })
    ).rejects.toMatchObject({
      code: "cooldown",
      retryAfter: 60
    })
  })
})

describe("updateUser", () => {
  it("refreshes the cached user from the response", async () => {
    server.on("PATCH", "/api/auth/user", {
      body: { user: { ...user, name: "Ada" } }
    })
    const client = createAuthClient()

    const updated = await client.updateUser({ name: "Ada" })

    expect(updated.name).toBe("Ada")
    expect(client.getCachedUser()?.name).toBe("Ada")
  })
})

describe("signOut", () => {
  it("clears local state for the local scope", async () => {
    server.on("POST", "/api/auth/verify-code", {
      body: { accessToken: fakeAccessToken(), user }
    })
    server.on("POST", "/api/auth/sign-out", { status: 204 })
    const client = createAuthClient()
    await client.verifyCode({ email: "ada@example.com", code: "123456" })

    await client.signOut()

    expect(client.getCachedUser()).toBeNull()
    expect(localStorage.getItem("auth-ts.user")).toBeNull()
  })

  it("keeps local state for the others scope, which is the point of it", async () => {
    server.on("POST", "/api/auth/verify-code", {
      body: { accessToken: fakeAccessToken(), user }
    })
    server.on("POST", "/api/auth/sign-out", { status: 204 })
    const client = createAuthClient()
    await client.verifyCode({ email: "ada@example.com", code: "123456" })

    await client.signOut({ scope: "others" })

    expect(client.getCachedUser()).toMatchObject({ email: "ada@example.com" })
  })

  it("sends the account axis only when it is given", async () => {
    server.on("POST", "/api/auth/sign-out", { status: 204 })
    server.on("POST", "/api/auth/sign-out", { status: 204 })
    const client = createAuthClient()

    await client.signOut()
    expect(server.requests.at(-1)?.body).toEqual({ scope: "local" })

    await client.signOut({ scope: "global", account: "current" })
    expect(server.requests.at(-1)?.body).toEqual({
      scope: "global",
      account: "current"
    })
  })

  it("adopts the promoted account when the server switches to one", async () => {
    server.on("POST", "/api/auth/verify-code", {
      body: { accessToken: fakeAccessToken(), user }
    })
    server.on("POST", "/api/auth/sign-out", {
      body: { switchedTo: other, accessToken: fakeAccessToken() }
    })
    const client = createAuthClient()
    await client.verifyCode({ email: "ada@example.com", code: "123456" })

    const result = await client.signOut()

    expect(result?.switchedTo.email).toBe("grace@example.com")
    expect(client.getCachedUser()?.email).toBe("grace@example.com")
  })
})

describe("deleteUser", () => {
  it("reports the code challenge as a value, not an error", async () => {
    server.on("DELETE", "/api/auth/user", {
      status: 403,
      body: {
        error: { code: "codeSent", message: "Confirm with the code we sent." }
      }
    })

    expect(await createAuthClient().deleteUser()).toEqual({
      status: "codeRequired"
    })
  })

  it("clears everything once the account is gone", async () => {
    server.on("POST", "/api/auth/verify-code", {
      body: { accessToken: fakeAccessToken(), user }
    })
    server.on("DELETE", "/api/auth/user", { status: 204 })
    const client = createAuthClient()
    await client.verifyCode({ email: "ada@example.com", code: "123456" })

    expect(await client.deleteUser({ code: "123456" })).toEqual({
      status: "deleted"
    })
    expect(client.getCachedUser()).toBeNull()
  })

  it("still throws for a wrong code", async () => {
    server.on("DELETE", "/api/auth/user", {
      status: 401,
      body: {
        error: { code: "invalidCode", message: "That code is not valid." }
      }
    })

    await expect(
      createAuthClient().deleteUser({ code: "000000" })
    ).rejects.toMatchObject({ code: "invalidCode" })
  })
})

describe("sessions and accounts", () => {
  it("lists sessions and revokes another device without clearing local state", async () => {
    server.on("GET", "/api/auth/sessions", {
      body: {
        sessions: [
          {
            id: "a",
            current: true,
            createdAt: "2026-08-01T10:00:00.000Z",
            expiresAt: "2026-08-31T10:00:00.000Z"
          },
          {
            id: "b",
            current: false,
            createdAt: "2026-08-02T10:00:00.000Z",
            expiresAt: "2026-09-01T10:00:00.000Z"
          }
        ]
      }
    })
    server.on("DELETE", "/api/auth/sessions/b", { body: { current: false } })
    server.on("POST", "/api/auth/verify-code", {
      body: { accessToken: fakeAccessToken(), user }
    })

    const client = createAuthClient()
    await client.verifyCode({ email: "ada@example.com", code: "123456" })

    const sessions = await client.listSessions()
    expect(sessions).toHaveLength(2)
    // Dates are revived, so `SessionInfo` is honest on the client too.
    expect(sessions[0]?.createdAt).toBeInstanceOf(Date)
    expect(sessions[0]?.createdAt.toISOString()).toBe(
      "2026-08-01T10:00:00.000Z"
    )
    expect(sessions[1]?.expiresAt.getTime()).toBe(
      Date.parse("2026-09-01T10:00:00.000Z")
    )
    await client.revokeSession({ id: "b" })

    expect(client.getCachedUser()).toMatchObject({ email: "ada@example.com" })
    // One DELETE, and no second GET /sessions to work out whether it was the
    // current one — the server says so in the response.
    expect(
      server.requests.filter((request) => request.path === "/api/auth/sessions")
    ).toHaveLength(1)
  })

  it("clears local state when the server reports the revoked session as current", async () => {
    server.on("DELETE", "/api/auth/sessions/a", { body: { current: true } })
    server.on("POST", "/api/auth/verify-code", {
      body: { accessToken: fakeAccessToken(), user }
    })

    const client = createAuthClient()
    await client.verifyCode({ email: "ada@example.com", code: "123456" })
    await client.revokeSession({ id: "a" })

    expect(client.getCachedUser()).toBeNull()
  })

  it("switches accounts through the store, so subscribers see one change", async () => {
    server.on("POST", "/api/auth/verify-code", {
      body: { accessToken: fakeAccessToken(), user }
    })
    server.on("POST", "/api/auth/accounts/switch", {
      body: { accessToken: fakeAccessToken(), user: other }
    })

    const client = createAuthClient()
    await client.verifyCode({ email: "ada@example.com", code: "123456" })

    const seen: Array<string | null> = []
    client.subscribe((next) => seen.push(next?.email ?? null))
    await client.switchAccount({ userId: "user-2" })

    expect(seen).toEqual(["grace@example.com"])
    expect(client.getCachedUser()?.email).toBe("grace@example.com")
  })
})

describe("oauth navigation", () => {
  it("builds the sign-in url with redirect and locale", () => {
    const assign = vi.fn()
    vi.stubGlobal("location", { href: "https://app.example.com/login", assign })

    createAuthClient({ locale: "de" }).signIn({
      provider: "github",
      redirect: "/dashboard"
    })

    const target = new URL(assign.mock.calls[0]?.[0] as string)
    expect(target.pathname).toBe("/api/auth/sign-in/github")
    expect(target.searchParams.get("redirect")).toBe("/dashboard")
    expect(target.searchParams.get("locale")).toBe("de")
  })

  it("builds the connect url for the current user", () => {
    const assign = vi.fn()
    vi.stubGlobal("location", {
      href: "https://app.example.com/account",
      assign
    })

    createAuthClient().connect({ provider: "google" })

    expect(new URL(assign.mock.calls[0]?.[0] as string).pathname).toBe(
      "/api/auth/connect/google"
    )
  })
})

describe("locale", () => {
  it("sends Accept-Language and updates it at runtime", async () => {
    server.on("POST", "/api/auth/send-code", { body: { sent: true } })
    const client = createAuthClient({ locale: "de" })

    await client.sendCode({ email: "ada@example.com" })
    expect(server.requests[0]?.acceptLanguage).toBe("de")

    client.setLocale("fr")
    await client.sendCode({ email: "ada@example.com" })
    expect(server.requests[1]?.acceptLanguage).toBe("fr")
  })
})

describe("baseURL", () => {
  it("targets a different origin when configured", async () => {
    server.on("POST", "/api/auth/send-code", { body: { sent: true } })

    await createAuthClient({ baseURL: "https://auth.example.com" }).sendCode({
      email: "ada@example.com"
    })

    expect(server.requests[0]?.path).toBe("/api/auth/send-code")
    expect(server.requests[0]?.credentials).toBe("include")
  })
})
