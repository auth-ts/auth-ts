import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createAuthClient } from "../../src/core/create-auth-client.ts"
import { AuthError } from "../../src/lib/auth-error.ts"
import type { FakeAuthServer } from "../helpers/fake-auth-server.ts"
import { fakeAccessToken, fakeAuthServer } from "../helpers/fake-auth-server.ts"

const user = { id: "user-1", email: "ada@example.com", type: "user" as const }

let server: FakeAuthServer

beforeEach(() => {
  localStorage.clear()
  server = fakeAuthServer()
})

afterEach(() => {
  server.restore()
  vi.useRealTimers()
})

describe("construction", () => {
  it("performs no network request and touches no storage", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem")
    const getItem = vi.spyOn(Storage.prototype, "getItem")

    createAuthClient()

    expect(server.requests).toHaveLength(0)
    expect(setItem).not.toHaveBeenCalled()
    expect(getItem).not.toHaveBeenCalled()
  })

  it("works where there is no window at all, as during server rendering", () => {
    const savedLocalStorage = globalThis.localStorage
    delete (globalThis as { localStorage?: Storage }).localStorage

    try {
      expect(() => createAuthClient()).not.toThrow()
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        value: savedLocalStorage,
        configurable: true
      })
    }
  })
})

describe("getToken", () => {
  it("refreshes once and caches the token", async () => {
    server.on("POST", "/api/auth/token", {
      body: { accessToken: fakeAccessToken(), user }
    })
    const client = createAuthClient()

    const first = await client.getToken()
    const second = await client.getToken()

    expect(first).toBe(second)
    expect(
      server.requests.filter((entry) => entry.path === "/api/auth/token")
    ).toHaveLength(1)
  })

  it("sends credentials, which is what carries the refresh cookie", async () => {
    server.on("POST", "/api/auth/token", {
      body: { accessToken: fakeAccessToken(), user }
    })

    await createAuthClient().getToken()

    expect(server.requests[0]?.credentials).toBe("include")
  })

  it("makes exactly one request for ten concurrent callers", async () => {
    server.on("POST", "/api/auth/token", {
      body: { accessToken: fakeAccessToken(), user }
    })
    const client = createAuthClient()

    const tokens = await Promise.all(
      Array.from({ length: 10 }, () => client.getToken())
    )

    expect(new Set(tokens).size).toBe(1)
    expect(server.requests).toHaveLength(1)
  })

  it("refreshes early, inside the 60 second window before expiry", async () => {
    vi.useFakeTimers()
    server.on("POST", "/api/auth/token", {
      body: { accessToken: fakeAccessToken({ lifetimeSeconds: 600 }), user }
    })
    const client = createAuthClient()

    await client.getToken()

    // 8 minutes in: still comfortably valid.
    vi.advanceTimersByTime(8 * 60_000)
    await client.getToken()
    expect(server.requests).toHaveLength(1)

    // 9 minutes 10 seconds in: inside the refresh-ahead window, so it renews
    // rather than handing out a token that could die mid-request.
    vi.advanceTimersByTime(70_000)
    await client.getToken()
    expect(server.requests).toHaveLength(2)
  })

  it("clears both caches and throws on 401", async () => {
    server.on("POST", "/api/auth/token", {
      body: { accessToken: fakeAccessToken(), user }
    })
    const client = createAuthClient()
    await client.getToken()
    expect(localStorage.getItem("auth-ts.user")).toContain("ada@example.com")

    server.restore()
    server = fakeAuthServer()
    server.on("POST", "/api/auth/token", {
      status: 401,
      body: {
        error: { code: "unauthenticated", message: "You are not signed in." }
      }
    })
    client.clearToken()

    await expect(client.getToken()).rejects.toBeInstanceOf(AuthError)
    expect(localStorage.getItem("auth-ts.user")).toBeNull()
    expect(client.getCachedUser()).toBeNull()
  })

  it("throws on a server failure but keeps both caches, because a 500 is not a verdict", async () => {
    server.on("POST", "/api/auth/token", {
      body: { accessToken: fakeAccessToken(), user }
    })
    const client = createAuthClient()
    await client.getToken()

    // Every non-2xx becomes an AuthError; only unauthenticated means the
    // session is gone. Before this, a deploy-time 500 blanked every tab.
    for (const reply of [
      {
        status: 500,
        body: { error: { code: "internalError", message: "Something broke." } }
      },
      // A proxy answering for the server, with no JSON envelope at all.
      { status: 502, body: "Bad Gateway" },
      {
        status: 429,
        body: { error: { code: "rateLimited", message: "Slow down." } }
      }
    ]) {
      server.restore()
      server = fakeAuthServer()
      server.on("POST", "/api/auth/token", reply)
      client.clearToken()

      await expect(
        client.getToken(),
        String(reply.status)
      ).rejects.toBeInstanceOf(AuthError)
      expect(client.getCachedUser(), String(reply.status)).toMatchObject({
        email: "ada@example.com"
      })
      expect(localStorage.getItem("auth-ts.user")).toContain("ada@example.com")
    }
  })

  it("surfaces retryAfter from a throttled response", async () => {
    server.on("POST", "/api/auth/token", {
      status: 429,
      body: {
        error: {
          code: "rateLimited",
          message: "Too many attempts.",
          retryAfter: 42
        }
      }
    })

    await expect(createAuthClient().getToken()).rejects.toMatchObject({
      code: "rateLimited",
      retryAfter: 42
    })
  })
})

describe("getUser", () => {
  it("signs the user back in from a valid cookie when storage is empty", async () => {
    server.on("POST", "/api/auth/token", {
      body: { accessToken: fakeAccessToken(), user }
    })

    expect(await createAuthClient().getUser()).toMatchObject({
      email: "ada@example.com"
    })
  })

  it("costs nothing while the token is still valid", async () => {
    server.on("POST", "/api/auth/token", {
      body: { accessToken: fakeAccessToken(), user }
    })
    const client = createAuthClient()

    await client.getUser()
    await client.getUser()
    await client.getUser()

    expect(server.requests).toHaveLength(1)
  })

  it("resolves null when the session is gone", async () => {
    server.on("POST", "/api/auth/token", {
      status: 401,
      body: {
        error: { code: "unauthenticated", message: "You are not signed in." }
      }
    })

    expect(await createAuthClient().getUser()).toBeNull()
  })

  it("keeps the last known user when the network fails, because offline is not signed out", async () => {
    server.on("POST", "/api/auth/token", {
      body: { accessToken: fakeAccessToken(), user }
    })
    const client = createAuthClient()
    await client.getUser()

    server.restore()
    server = fakeAuthServer()
    server.on("POST", "/api/auth/token", { networkError: true })
    client.clearToken()

    expect(await client.getUser()).toMatchObject({ email: "ada@example.com" })
    expect(localStorage.getItem("auth-ts.user")).toContain("ada@example.com")
  })

  it("keeps the last known user when the server fails, not only when the network does", async () => {
    server.on("POST", "/api/auth/token", {
      body: { accessToken: fakeAccessToken(), user }
    })
    const client = createAuthClient()
    await client.getUser()

    server.restore()
    server = fakeAuthServer()
    server.on("POST", "/api/auth/token", {
      status: 500,
      body: { error: { code: "internalError", message: "Something broke." } }
    })
    client.clearToken()

    // The auth server being mid-deploy is not the session being gone.
    expect(await client.getUser()).toMatchObject({ email: "ada@example.com" })
  })

  it("shares one refresh between concurrent callers", async () => {
    server.on("POST", "/api/auth/token", {
      body: { accessToken: fakeAccessToken(), user }
    })
    const client = createAuthClient()

    await Promise.all(Array.from({ length: 5 }, () => client.getUser()))

    expect(server.requests).toHaveLength(1)
  })
})

describe("subscribe", () => {
  it("fires once per change with the new user, and stops after unsubscribing", async () => {
    server.on("POST", "/api/auth/token", {
      body: { accessToken: fakeAccessToken(), user }
    })
    server.on("POST", "/api/auth/logout", { status: 204 })

    const client = createAuthClient()
    const seen: Array<string | null> = []
    const unsubscribe = client.subscribe((next) =>
      seen.push(next?.email ?? null)
    )

    await client.getUser()
    await client.logout()

    expect(seen).toEqual(["ada@example.com", null])

    unsubscribe()
    await client
      .verifyCode({ email: "ada@example.com", code: "123456" })
      .catch(() => {})
    expect(seen).toHaveLength(2)
  })

  it("follows a sign-out in another tab without making a request", async () => {
    const client = createAuthClient()
    const seen: Array<string | null> = []
    client.subscribe((next) => seen.push(next?.email ?? null))

    globalThis.dispatchEvent(
      new StorageEvent("storage", {
        key: "auth-ts.user",
        newValue: JSON.stringify(user)
      })
    )
    globalThis.dispatchEvent(
      new StorageEvent("storage", { key: "auth-ts.user", newValue: null })
    )

    expect(seen).toEqual(["ada@example.com", null])
    expect(server.requests).toHaveLength(0)
  })
})

describe("cross-tab sync", () => {
  it("drops this tab's access token when another tab signs out", async () => {
    server.on("POST", "/api/auth/token", {
      body: { accessToken: fakeAccessToken(), user }
    })
    const client = createAuthClient()

    await client.getToken()
    expect(server.requests).toHaveLength(1)

    // Another tab signs out: the storage event carries the user change, but the
    // token is per-tab memory and must be discarded here too, or this tab would
    // keep querying the data plane as a signed-out user.
    globalThis.dispatchEvent(
      new StorageEvent("storage", { key: "auth-ts.user", newValue: null })
    )

    server.on("POST", "/api/auth/token", {
      status: 401,
      body: {
        error: { code: "unauthenticated", message: "You are not signed in." }
      }
    })

    await expect(client.getToken()).rejects.toMatchObject({
      code: "unauthenticated"
    })
    expect(server.requests).toHaveLength(2)
  })

  it("treats an unreadable value from another tab as signed out rather than throwing", async () => {
    // Another tab — an older app version, another same-origin script — wrote
    // something that is not JSON. A throw inside the listener would leave this
    // tab's token alive while every other tab has moved on.
    server.on("POST", "/api/auth/token", {
      body: { accessToken: fakeAccessToken(), user }
    })
    const client = createAuthClient()
    await client.getToken()
    const seen: Array<string | null> = []
    client.subscribe((next) => seen.push(next?.email ?? null))

    globalThis.dispatchEvent(
      new StorageEvent("storage", {
        key: "auth-ts.user",
        newValue: "{not json"
      })
    )

    expect(seen).toEqual([null])
    server.on("POST", "/api/auth/token", {
      status: 401,
      body: {
        error: { code: "unauthenticated", message: "You are not signed in." }
      }
    })
    await expect(client.getToken()).rejects.toMatchObject({
      code: "unauthenticated"
    })
  })

  it("ignores storage events for unrelated keys", async () => {
    server.on("POST", "/api/auth/token", {
      body: { accessToken: fakeAccessToken(), user }
    })
    const client = createAuthClient()
    client.subscribe(() => {})
    await client.getToken()

    globalThis.dispatchEvent(
      new StorageEvent("storage", { key: "some-other-app", newValue: null })
    )

    await client.getToken()
    expect(server.requests).toHaveLength(1)
  })
})
