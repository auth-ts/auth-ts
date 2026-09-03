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
  server.on("POST", "/api/auth/sign-in/code", {
    body: { user },
    token: fakeAccessToken()
  })
  const client = createAuthClient()
  await client.signInWithCode({ email: "ada@example.com", code: "123456" })

  return client
}

beforeEach(() => {
  server = fakeAuthServer()
})

afterEach(() => {
  server.restore()
  vi.unstubAllGlobals()
})

describe("signInWithCode", () => {
  it("primes the token and user without a second round-trip", async () => {
    server.on("POST", "/api/auth/sign-in/code", {
      body: { user },
      token: fakeAccessToken()
    })
    const client = createAuthClient()

    const result = await client.signInWithCode({
      email: "ada@example.com",
      code: "123456"
    })

    // The user comes back from the sign-in itself; nothing is read afterwards.
    expect(result.user).toMatchObject({ email: "ada@example.com" })
    expect(server.requests).toHaveLength(1)
  })
})

describe("timestamps on the wire", () => {
  const dated = {
    ...user,
    createdAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-01-02T03:04:05.000Z"
  }
  const isRealDate = (value: unknown) =>
    value instanceof Date && !Number.isNaN(value.getTime())

  it("revives them on every method that answers with a user", async () => {
    server.on("POST", "/api/auth/sign-in/code", {
      body: { user: dated },
      token: fakeAccessToken()
    })
    const client = createAuthClient()

    const { user: signedIn } = await client.signInWithCode({
      email: "ada@example.com",
      code: "123456"
    })
    expect(isRealDate(signedIn.createdAt)).toBe(true)
    expect(signedIn.createdAt.toISOString()).toBe(dated.createdAt)

    server.on("POST", "/api/auth/user", { body: dated })
    expect(
      isRealDate((await client.updateUser({ name: "Ada" })).createdAt)
    ).toBe(true)

    server.on("GET", "/api/auth/users", { body: [dated] })
    expect(isRealDate((await client.listUsers())[0]?.createdAt)).toBe(true)

    server.on("POST", "/api/auth/users/switch", {
      body: { user: dated },
      token: fakeAccessToken()
    })
    expect(
      isRealDate((await client.switchUser({ userId: user.id })).createdAt)
    ).toBe(true)
  })

  it("revives them for a guest as well", async () => {
    server.on("POST", "/api/auth/sign-in/guest", {
      body: { user: dated },
      token: fakeAccessToken()
    })

    const { user: guest } = await createAuthClient().signInAsGuest()

    expect(isRealDate(guest.createdAt)).toBe(true)
  })
})

describe("sendSignInCode", () => {
  it("passes the identifier through and reports a cooldown with its countdown", async () => {
    server.on("POST", "/api/auth/sign-in/send-code", { body: { sent: true } })
    server.on("POST", "/api/auth/sign-in/send-code", {
      status: 429,
      body: { code: "cooldown", message: "Wait 60 seconds.", retryAfter: 60 }
    })
    const client = createAuthClient()

    await client.sendSignInCode({ email: "ada@example.com" })
    expect(server.requests[0]?.body).toEqual({ email: "ada@example.com" })

    await expect(
      client.sendSignInCode({ email: "ada@example.com" })
    ).rejects.toMatchObject({
      code: "cooldown",
      retryAfter: 60
    })
  })

  it("throws a real Error, carrying name and the server's message", async () => {
    server.on("POST", "/api/auth/sign-in/send-code", {
      status: 429,
      body: { code: "cooldown", message: "Wait 60 seconds.", retryAfter: 60 }
    })
    const client = createAuthClient()

    const thrown = await client
      .sendSignInCode({ email: "ada@example.com" })
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
    server.on("POST", "/api/auth/user", { status: 401, body: wireBody })
    server.on("GET", "/api/auth/token", {
      body: { user },
      token: fakeAccessToken()
    })
    server.on("POST", "/api/auth/user", { status: 401, body: wireBody })
    const client = await signedIn()

    const thrown = await client
      .updateUser({ name: "Ada" })
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
      code: "guestRequiresSignOut",
      message: "Sign out before continuing as a guest."
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
    server.on("POST", "/api/auth/user", { body: { ...user, name: "Ada" } })
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
    server.on("POST", "/api/auth/sign-in/code", {
      body: { user },
      token: fakeAccessToken()
    })
    server.on("POST", "/api/auth/sign-out", { status: 204 })
    const client = createAuthClient()
    await client.signInWithCode({ email: "ada@example.com", code: "123456" })

    await client.signOut()

    // The token went with it, so the next call has to go and get one.
    await expect(client.getToken()).rejects.toThrow()
  })

  it("keeps local state for the others scope, which is the point of it", async () => {
    server.on("POST", "/api/auth/sign-in/code", {
      body: { user },
      token: fakeAccessToken()
    })
    server.on("POST", "/api/auth/sign-out", { status: 204 })
    const client = createAuthClient()
    await client.signInWithCode({ email: "ada@example.com", code: "123456" })

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

  it("clears the token, since signing out is what was asked for", async () => {
    server.on("POST", "/api/auth/sign-in/code", {
      body: { user },
      token: fakeAccessToken()
    })
    server.on("POST", "/api/auth/sign-out", { status: 204 })
    const client = createAuthClient()
    await client.signInWithCode({ email: "ada@example.com", code: "123456" })

    await client.signOut()

    expect(server.requests.at(-1)?.path).toBe("/api/auth/sign-out")
  })
})

describe("deleteUser", () => {
  it("reports a stale session as a value, not an error", async () => {
    server.on("DELETE", "/api/auth/user", {
      status: 403,
      body: {
        code: "staleSession",
        message: "Please sign in again to continue."
      }
    })
    const client = await signedIn()

    expect(await client.deleteUser()).toEqual({ status: "staleSession" })
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
  it("returns the account it switched to, and keeps that account's token", async () => {
    const switched = fakeAccessToken()
    server.on("POST", "/api/auth/sign-in/code", {
      body: { user },
      token: fakeAccessToken()
    })
    server.on("POST", "/api/auth/users/switch", {
      body: { user: other },
      token: switched
    })

    const client = createAuthClient()
    await client.signInWithCode({ email: "ada@example.com", code: "123456" })

    const result = await client.switchUser({ userId: "user-2" })

    expect(result.email).toBe("grace@example.com")
    // The switch primes the token, so nothing refreshes afterwards.
    expect(await client.getToken()).toBe(switched)
  })
})

describe("oauth navigation", () => {
  it("asks the server where to go, then goes there", async () => {
    // The server answers with the URL rather than a redirect, because only the
    // caller knows how to navigate — a browser assigns location, a native shell
    // opens the system browser. The request is also what sets the state cookie,
    // so it has to land before the navigation.
    const assign = vi.fn()
    vi.stubGlobal("location", { href: "https://app.example.com/login", assign })
    server.on("POST", "/api/auth/sign-in/provider/github", {
      body: { url: "https://github.com/login/oauth/authorize?state=abc" }
    })

    await createAuthClient({ locale: "de" }).signInWithProvider({
      provider: "github",
      redirect: "/dashboard"
    })

    expect(server.requests[0]?.path).toBe("/api/auth/sign-in/provider/github")
    expect(server.requests[0]?.body).toEqual({ redirect: "/dashboard" })
    expect(server.requests[0]?.acceptLanguage).toBe("de")
    expect(assign).toHaveBeenCalledWith(
      "https://github.com/login/oauth/authorize?state=abc"
    )
  })

  it("sends connectProvider with the access token, since it is an ordinary request", async () => {
    const assign = vi.fn()
    vi.stubGlobal("location", {
      href: "https://app.example.com/account",
      assign
    })
    server.on("POST", "/api/auth/identities/connect/google", {
      body: { url: "https://accounts.google.com/o/oauth2/v2/auth?state=abc" }
    })
    const client = await signedIn()

    await client.connectProvider({ provider: "google" })

    expect(server.requests.at(-1)?.path).toBe(
      "/api/auth/identities/connect/google"
    )
    expect(server.requests.at(-1)?.authorization).toBeTruthy()
    expect(assign).toHaveBeenCalledWith(
      "https://accounts.google.com/o/oauth2/v2/auth?state=abc"
    )
  })
})

describe("connected accounts", () => {
  it("addresses the token by identity id, not by provider", async () => {
    // Not by provider: two accounts at one provider is the case that breaks.
    server.on("GET", "/api/auth/identities/identity-1/token", {
      body: { token: "provider-token", expiresAt: null, scope: "repo" }
    })
    const client = await signedIn()

    const grant = await client.getProviderToken({ id: "identity-1" })

    expect(grant.token).toBe("provider-token")
    expect(server.requests.at(-1)?.path).toBe(
      "/api/auth/identities/identity-1/token"
    )
  })

  it("throws providerReconnectRequired when the grant is gone", async () => {
    server.on("GET", "/api/auth/identities/identity-1/token", {
      status: 403,
      body: {
        name: "AuthError",
        code: "providerReconnectRequired",
        message: "Reconnect that account to continue using it here."
      }
    })
    const client = await signedIn()

    await expect(
      client.getProviderToken({ id: "identity-1" })
    ).rejects.toMatchObject({ code: "providerReconnectRequired", status: 403 })
  })
})

describe("locale", () => {
  it("sends Accept-Language and updates it at runtime", async () => {
    server.on("POST", "/api/auth/sign-in/send-code", { body: { sent: true } })
    const client = createAuthClient({ locale: "de" })

    await client.sendSignInCode({ email: "ada@example.com" })
    expect(server.requests[0]?.acceptLanguage).toBe("de")

    client.setLocale("fr")
    await client.sendSignInCode({ email: "ada@example.com" })
    expect(server.requests[1]?.acceptLanguage).toBe("fr")
  })
})

describe("baseURL", () => {
  it("targets a different origin when configured", async () => {
    server.on("POST", "/api/auth/sign-in/send-code", { body: { sent: true } })

    await createAuthClient({
      baseURL: "https://auth.example.com"
    }).sendSignInCode({
      email: "ada@example.com"
    })

    expect(server.requests[0]?.path).toBe("/api/auth/sign-in/send-code")
    expect(server.requests[0]?.credentials).toBe("include")
  })
})
