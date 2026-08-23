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

/** A client holding a live token, which every authenticated call needs. */
const signedIn = async () => {
  server.on("POST", "/api/auth/verify-code", {
    body: { user },
    token: fakeAccessToken()
  })
  const client = createAuthClient()
  await client.verifyCode({ email: "ada@example.com", code: "123456" })

  return client
}

beforeEach(() => {
  server = fakeAuthServer()
})

afterEach(() => {
  server.restore()
  vi.unstubAllGlobals()
})

describe("verifyCode", () => {
  it("primes the token and user without a second round-trip", async () => {
    server.on("POST", "/api/auth/verify-code", {
      body: { user },
      token: fakeAccessToken()
    })
    const client = createAuthClient()

    const result = await client.verifyCode({
      email: "ada@example.com",
      code: "123456"
    })

    // The user comes back from the sign-in itself; nothing is read afterwards.
    expect(result.user).toMatchObject({ email: "ada@example.com" })
    expect(server.requests).toHaveLength(1)
  })
})

describe("sendCode", () => {
  it("passes the identifier through and reports a cooldown with its countdown", async () => {
    server.on("POST", "/api/auth/send-code", { body: { sent: true } })
    server.on("POST", "/api/auth/send-code", {
      status: 429,
      body: { code: "cooldown", message: "Wait 60 seconds.", retryAfter: 60 }
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

  it("throws a real Error, carrying name and the server's message", async () => {
    server.on("POST", "/api/auth/send-code", {
      status: 429,
      body: { code: "cooldown", message: "Wait 60 seconds.", retryAfter: 60 }
    })
    const client = createAuthClient()

    const thrown = await client
      .sendCode({ email: "ada@example.com" })
      .then(() => null)
      .catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).toMatchObject({
      name: "AuthError",
      message: "Wait 60 seconds."
    })
  })

  it("throws matching the wire body on a 401, plus the status", async () => {
    const wireBody = {
      name: "AuthError",
      code: "unauthenticated",
      message: "You are not signed in."
    }
    // A 401 makes the client refresh its token and retry once, so both the
    // refresh and the retried request need answers.
    server.on("DELETE", "/api/auth/sessions/other", {
      status: 401,
      body: wireBody
    })
    server.on("GET", "/api/auth/token", {
      body: { user },
      token: fakeAccessToken()
    })
    server.on("DELETE", "/api/auth/sessions/other", {
      status: 401,
      body: wireBody
    })
    const client = await signedIn()

    const thrown = await client
      .revokeSession({ id: "other" })
      .then(() => null)
      .catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).toMatchObject({ ...wireBody, status: 401 })
  })
})

describe("signInAsGuest", () => {
  it("throws the error body's fields when the browser is already signed in", async () => {
    const wireBody = {
      name: "AuthError",
      code: "alreadySignedIn",
      message: "You are already signed in."
    }
    server.on("POST", "/api/auth/sign-in/guest", {
      status: 409,
      body: wireBody
    })
    const client = createAuthClient()

    const thrown = await client
      .signInAsGuest()
      .then(() => null)
      .catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).toMatchObject({ ...wireBody, status: 409 })
  })
})

describe("updateUser", () => {
  it("refreshes the mirror from the row the update returned", async () => {
    server.on("POST", "/api/auth/user", {
      body: { user: { ...user, name: "Ada" } }
    })
    const client = await signedIn()

    const updated = await client.updateUser({ name: "Ada" })

    expect(updated.name).toBe("Ada")
    // The update answers with the row, so nothing is read back — and the token
    // from the sign-in is still live, so nothing is refreshed either.
    expect(
      server.requests.filter((entry) => entry.path === "/api/auth/user")
    ).toHaveLength(1)
  })
})

describe("signOut", () => {
  it("clears local state for the local scope", async () => {
    server.on("POST", "/api/auth/verify-code", {
      body: { user },
      token: fakeAccessToken()
    })
    server.on("POST", "/api/auth/sign-out", { status: 204 })
    const client = createAuthClient()
    await client.verifyCode({ email: "ada@example.com", code: "123456" })

    await client.signOut()

    // The token went with it, so the next call has to go and get one.
    await expect(client.getToken()).rejects.toThrow()
  })

  it("keeps local state for the others scope, which is the point of it", async () => {
    server.on("POST", "/api/auth/verify-code", {
      body: { user },
      token: fakeAccessToken()
    })
    server.on("POST", "/api/auth/sign-out", { status: 204 })
    const client = createAuthClient()
    await client.verifyCode({ email: "ada@example.com", code: "123456" })

    await client.signOut({ scope: "others" })
  })

  it("names an account only when it is given one", async () => {
    server.on("POST", "/api/auth/sign-out", { status: 204 })
    server.on("POST", "/api/auth/sign-out", { status: 204 })
    // The first sign-out drops the token, so the second buys another.
    server.on("GET", "/api/auth/token", {
      body: { user },
      token: fakeAccessToken()
    })
    const client = await signedIn()

    await client.signOut()
    expect(server.requests.at(-1)?.body).toEqual({ scope: "local" })

    await client.signOut({ scope: "global", userId: "user_ada" })
    expect(server.requests.at(-1)?.body).toEqual({
      scope: "global",
      userId: "user_ada"
    })
  })

  it("adopts the promoted account when the server switches to one", async () => {
    server.on("POST", "/api/auth/verify-code", {
      body: { user },
      token: fakeAccessToken()
    })
    server.on("POST", "/api/auth/sign-out", {
      body: { switchedTo: other, token: fakeAccessToken() }
    })
    const client = createAuthClient()
    await client.verifyCode({ email: "ada@example.com", code: "123456" })

    const result = await client.signOut()

    expect(result?.switchedTo.email).toBe("grace@example.com")
  })
})

describe("deleteUser", () => {
  it("reports the code challenge as a value, not an error", async () => {
    server.on("DELETE", "/api/auth/user", {
      status: 403,
      body: { code: "codeSent", message: "Confirm with the code we sent." }
    })
    const client = await signedIn()

    expect(await client.deleteUser()).toEqual({ status: "codeRequired" })
  })

  it("clears everything once the account is gone", async () => {
    server.on("DELETE", "/api/auth/user", { status: 204 })
    const client = await signedIn()

    expect(await client.deleteUser({ code: "123456" })).toEqual({
      status: "deleted"
    })
  })

  it("still throws for a wrong code", async () => {
    server.on("DELETE", "/api/auth/user", {
      status: 401,
      body: { code: "invalidCode", message: "That code is not valid." }
    })
    const client = await signedIn()

    // Not retried: a wrong code is a verdict on the request, not on the
    // credential, so the delete is sent once and no token is refreshed.
    await expect(client.deleteUser({ code: "000000" })).rejects.toMatchObject({
      code: "invalidCode"
    })
    expect(
      server.requests.filter((entry) => entry.path === "/api/auth/token")
    ).toHaveLength(0)
    expect(
      server.requests.filter((entry) => entry.path === "/api/auth/user")
    ).toHaveLength(1)
  })
})

describe("sessions and accounts", () => {
  it("lists sessions and revokes another device without clearing local state", async () => {
    server.on("GET", "/api/auth/sessions", {
      body: [
        {
          id: "a",
          createdAt: "2026-08-01T10:00:00.000Z",
          expiresAt: "2026-08-31T10:00:00.000Z"
        },
        {
          id: "b",
          createdAt: "2026-08-02T10:00:00.000Z",
          expiresAt: "2026-09-01T10:00:00.000Z"
        }
      ]
    })
    server.on("DELETE", "/api/auth/sessions/b", { body: { current: false } })
    server.on("POST", "/api/auth/verify-code", {
      body: { user },
      token: fakeAccessToken()
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
    // One DELETE, and no second GET /sessions to work out whether it was the
    // current one — the server says so in the response.
    expect(
      server.requests.filter((request) => request.path === "/api/auth/sessions")
    ).toHaveLength(1)
  })

  it("clears local state when the server reports the revoked session as current", async () => {
    server.on("DELETE", "/api/auth/sessions/a", { body: { current: true } })
    server.on("POST", "/api/auth/verify-code", {
      body: { user },
      token: fakeAccessToken()
    })

    const client = createAuthClient()
    await client.verifyCode({ email: "ada@example.com", code: "123456" })
    await client.revokeSession({ id: "a" })
  })

  it("returns the account it switched to, and keeps that account's token", async () => {
    const switched = fakeAccessToken()
    server.on("POST", "/api/auth/verify-code", {
      body: { user },
      token: fakeAccessToken()
    })
    server.on("POST", "/api/auth/accounts/switch", {
      body: { user: other },
      token: switched
    })

    const client = createAuthClient()
    await client.verifyCode({ email: "ada@example.com", code: "123456" })

    const result = await client.switchAccount({ userId: "user-2" })

    expect(result.email).toBe("grace@example.com")
    // The switch primes the token, so nothing refreshes afterwards.
    expect(await client.getToken()).toBe(switched)
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
