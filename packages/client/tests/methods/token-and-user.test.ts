import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createAuthClient } from "../../src/core/create-auth-client"
import { AuthError } from "../../src/lib/auth-error"
import type { FakeAuthServer } from "../helpers/fake-auth-server"
import {
  fakeAccessToken,
  fakeAuthServer,
  setSessionHint
} from "../helpers/fake-auth-server"

const user = { id: "user-1", email: "ada@example.com", type: "user" as const }

let server: FakeAuthServer

beforeEach(() => {
  server = fakeAuthServer()
})

afterEach(() => {
  server.restore()
  vi.useRealTimers()
})

describe("construction", () => {
  it("performs no network request", () => {
    createAuthClient()

    expect(server.requests).toHaveLength(0)
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

describe("decodeToken", () => {
  it("reads the claims the browser has a use for, and says when they have expired", () => {
    const client = createAuthClient()

    const live = client.decodeToken(fakeAccessToken())
    expect(live?.claims).toMatchObject({ sub: "user-1", sid: "session-1" })
    expect(live?.expired).toBe(false)

    const spent = client.decodeToken(
      fakeAccessToken({
        issuedAt: Date.now() - 3_600_000,
        lifetimeSeconds: 600
      })
    )
    expect(spent?.expired).toBe(true)

    expect(client.decodeToken("not a token")).toBeNull()
  })
})

describe("getToken", () => {
  it("reports the user it minted from, and only when it minted", async () => {
    server.on("GET", "/api/auth/token", {
      body: { user },
      token: fakeAccessToken()
    })
    const client = createAuthClient()

    const minted: unknown[] = []
    await client.getToken({ onRefresh: (result) => minted.push(result.user) })
    expect(minted).toHaveLength(1)
    expect(minted[0]).toMatchObject({ id: user.id })
    // Dates survive the wire as Dates, since the row's type says they are.
    expect((minted[0] as { createdAt: Date }).createdAt).toBeInstanceOf(Date)

    // Served from memory: nothing was read, so there is no user to report.
    await client.getToken({ onRefresh: (result) => minted.push(result.user) })
    expect(minted).toHaveLength(1)
  })

  it("refreshes once and caches the token", async () => {
    server.on("GET", "/api/auth/token", {
      body: { user },
      token: fakeAccessToken()
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
    server.on("GET", "/api/auth/token", {
      body: { user },
      token: fakeAccessToken()
    })

    await createAuthClient().getToken()

    expect(server.requests[0]?.credentials).toBe("include")
  })

  it("makes exactly one request for ten concurrent callers", async () => {
    server.on("GET", "/api/auth/token", {
      body: { user },
      token: fakeAccessToken()
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
    server.on("GET", "/api/auth/token", {
      body: { user },
      token: fakeAccessToken({ lifetimeSeconds: 600 })
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

  it("clears the token and resolves null on 401, because signed out is an answer", async () => {
    server.on("GET", "/api/auth/token", {
      body: { user },
      token: fakeAccessToken()
    })
    const client = createAuthClient()
    await client.getToken()

    server.restore()
    server = fakeAuthServer()
    server.on("GET", "/api/auth/token", {
      status: 401,
      body: { code: "unauthenticated", message: "You are not signed in." }
    })
    client.clearToken()

    expect(await client.getToken()).toBeNull()
    // The refused token is forgotten with it, so nothing presents it again.
    expect(await client.getToken()).toBeNull()
  })

  it("resolves null and clears the token when the server says nobody is here", async () => {
    server.on("GET", "/api/auth/token", {
      body: { user },
      token: fakeAccessToken()
    })
    const client = createAuthClient()
    await client.getToken()

    server.restore()
    server = fakeAuthServer()
    // 200 with a null body: the answer to "who is here", not a failure.
    server.on("GET", "/api/auth/token", { body: null })
    client.clearToken()

    expect(await client.getToken()).toBeNull()
    await expect(client.getUser()).resolves.toBeNull()
  })

  it("still throws from the methods that need a credential", async () => {
    server.on("GET", "/api/auth/token", {
      status: 401,
      body: { code: "unauthenticated", message: "You are not signed in." }
    })
    const client = createAuthClient()

    // Asking who is here and asking to act as them are different questions.
    expect(await client.getToken()).toBeNull()
    await expect(client.listSessions()).rejects.toMatchObject({
      code: "unauthenticated"
    })
  })

  it("throws on a server failure and keeps the token, because a 500 is not a verdict", async () => {
    server.on("GET", "/api/auth/token", {
      body: { user },
      token: fakeAccessToken()
    })
    const client = createAuthClient()
    await client.getToken()

    // Every non-2xx becomes an AuthError; only unauthenticated means the
    // session is gone. Before this, a deploy-time 500 blanked every tab.
    for (const reply of [
      {
        status: 500,
        body: { code: "internalError", message: "Something broke." }
      },
      // A proxy answering for the server, with no JSON envelope at all.
      { status: 502, body: "Bad Gateway" },
      {
        status: 429,
        body: { code: "rateLimited", message: "Slow down." }
      }
    ]) {
      server.restore()
      server = fakeAuthServer()
      server.on("GET", "/api/auth/token", reply)
      client.clearToken()

      await expect(
        client.getToken(),
        String(reply.status)
      ).rejects.toBeInstanceOf(AuthError)
    }
  })

  it("surfaces retryAfter from a throttled response", async () => {
    server.on("GET", "/api/auth/token", {
      status: 429,
      body: {
        code: "rateLimited",
        message: "Too many attempts.",
        retryAfter: 42
      }
    })

    await expect(createAuthClient().getToken()).rejects.toMatchObject({
      code: "rateLimited",
      retryAfter: 42
    })
  })
})

describe("the session hint", () => {
  it("costs a signed-out browser no request at all", async () => {
    setSessionHint(undefined)
    const client = createAuthClient()

    expect(await client.getToken()).toBeNull()
    await expect(client.getUser()).resolves.toBeNull()
    // The point of the whole mechanism: no 401 on load, none on tab focus.
    expect(server.requests).toHaveLength(0)
  })

  it("still throws from requireToken, which has nothing to do with null", async () => {
    setSessionHint(undefined)
    const client = createAuthClient()

    await expect(client.listSessions()).rejects.toMatchObject({
      code: "unauthenticated",
      status: 401
    })
    expect(server.requests).toHaveLength(0)
  })

  it("reads a user id as a live session and asks", async () => {
    server.on("GET", "/api/auth/token", {
      body: { user },
      token: fakeAccessToken()
    })
    setSessionHint(user.id)
    const client = createAuthClient()

    expect(await client.getToken()).toBeTruthy()
    expect(server.requests).toHaveLength(1)
  })

  it("believes an explicit out the same way", async () => {
    setSessionHint("out")
    const client = createAuthClient()

    expect(await client.getToken()).toBeNull()
    expect(server.requests).toHaveLength(0)
  })

  it("forgets a token it is still holding when the hint has gone", async () => {
    // Another tab signed out; this one must not keep serving from its cache.
    server.on("GET", "/api/auth/token", {
      body: { user },
      token: fakeAccessToken()
    })
    const client = createAuthClient()
    await client.getToken()

    setSessionHint("out")
    client.clearToken()

    expect(await client.getToken()).toBeNull()
    expect(server.requests).toHaveLength(1)
  })

  it("asks anyway when the auth server is on another origin", async () => {
    // There the hint may simply never have been delivered, and a wrong "signed
    // out" is worse than a wasted request.
    setSessionHint(undefined)
    const client = createAuthClient({ baseURL: "https://api.example.test" })
    server.on("GET", "/api/auth/token", { body: null })

    expect(await client.getToken()).toBeNull()
    expect(server.requests).toHaveLength(1)
  })

  it("is ignored by a client holding its own cookie jar", async () => {
    // A native app has the refresh cookie itself; nothing to hint about.
    setSessionHint(undefined)
    const storage = new Map<string, string>()
    const client = createAuthClient({
      cookieStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => void storage.set(key, value),
        removeItem: (key) => void storage.delete(key)
      }
    })
    server.on("GET", "/api/auth/token", { body: null })

    expect(await client.getToken()).toBeNull()
    expect(server.requests).toHaveLength(1)
  })
})

describe("a refused token", () => {
  it("retries once with a fresh one, because refresh-ahead can still lose", async () => {
    // A key rotated between mint and use, or a device clock far enough off that
    // the refresh-ahead window never fired. Both look like a 401 on a token the
    // client believed in.
    server.on("POST", "/api/auth/sign-in/code", {
      body: { user },
      token: fakeAccessToken()
    })
    server.on("GET", "/api/auth/sessions", {
      status: 401,
      body: { code: "unauthenticated", message: "You are not signed in." }
    })
    server.on("GET", "/api/auth/sessions", { body: [] })
    server.on("GET", "/api/auth/token", {
      body: { user },
      token: fakeAccessToken()
    })
    const client = createAuthClient()
    await client.signInWithCode({ email: "ada@example.com", code: "123456" })

    expect(await client.listSessions()).toEqual([])
    expect(
      server.requests.filter((entry) => entry.path === "/api/auth/token")
    ).toHaveLength(1)
  })

  it("gives up when the refresh is refused too, rather than looping", async () => {
    const refused = {
      status: 401,
      body: { code: "unauthenticated", message: "You are not signed in." }
    }
    server.on("POST", "/api/auth/sign-in/code", {
      body: { user },
      token: fakeAccessToken()
    })
    server.on("GET", "/api/auth/sessions", refused)
    server.on("GET", "/api/auth/token", refused)
    const client = createAuthClient()
    await client.signInWithCode({ email: "ada@example.com", code: "123456" })

    await expect(client.listSessions()).rejects.toMatchObject({
      code: "unauthenticated"
    })
    expect(
      server.requests.filter((entry) => entry.path === "/api/auth/sessions")
    ).toHaveLength(1)
  })
})

describe("getUser", () => {
  it("reads the server every time, because a name can change elsewhere", async () => {
    server.on("GET", "/api/auth/token", {
      body: { user },
      token: fakeAccessToken()
    })
    server.on("GET", "/api/auth/user", { body: user })
    const client = createAuthClient()

    await client.getUser()
    await client.getUser()
    await client.getUser()

    // The first call takes the user off the refresh it needed anyway; after
    // that it is a read per call, because caching is the caller's to decide.
    expect(
      server.requests.filter((entry) => entry.path === "/api/auth/token")
    ).toHaveLength(1)
    expect(
      server.requests.filter((entry) => entry.path === "/api/auth/user")
    ).toHaveLength(2)
  })

  it("costs one request on a cold start, since the refresh carries the user", async () => {
    server.on("GET", "/api/auth/token", {
      body: { user },
      token: fakeAccessToken()
    })

    const found = await createAuthClient().getUser()

    expect(found?.email).toBe("ada@example.com")
    expect(server.requests).toHaveLength(1)
  })

  it("resolves null when the session is gone", async () => {
    server.on("GET", "/api/auth/token", {
      status: 401,
      body: { code: "unauthenticated", message: "You are not signed in." }
    })

    expect(await createAuthClient().getUser()).toBeNull()
  })

  it("returns a token nearing expiry at once, refreshing behind the caller", async () => {
    // The store measures a token's life from when it arrived, not from `iat`,
    // so the clock has to move rather than the token being backdated.
    vi.useFakeTimers()
    try {
      const first = fakeAccessToken()
      const second = fakeAccessToken()
      server.on("GET", "/api/auth/token", {
        body: { user },
        token: first
      })
      server.on("GET", "/api/auth/token", {
        body: { user },
        token: second
      })
      const client = createAuthClient()

      expect(await client.getToken()).toBe(first)

      // 55 seconds left: inside the refresh-ahead window, outside the one that
      // makes a caller wait.
      vi.setSystemTime(Date.now() + 545_000)
      expect(await client.getToken()).toBe(first)

      // It did not wait, but it did start the refresh.
      for (let tick = 0; tick < 10; tick++) await Promise.resolve()
      expect(
        server.requests.filter((request) => request.path === "/api/auth/token")
      ).toHaveLength(2)
      expect(await client.getToken()).toBe(second)
    } finally {
      vi.useRealTimers()
    }
  })

  it("waits for the new token when the cached one is nearly spent", async () => {
    vi.useFakeTimers()
    try {
      const spent = fakeAccessToken()
      const fresh = fakeAccessToken()
      server.on("GET", "/api/auth/token", {
        body: { user },
        token: spent
      })
      server.on("GET", "/api/auth/token", {
        body: { user },
        token: fresh
      })
      const client = createAuthClient()

      expect(await client.getToken()).toBe(spent)

      // Five seconds left — not enough to outlive the request it would be used for.
      vi.setSystemTime(Date.now() + 595_000)
      expect(await client.getToken()).toBe(fresh)
    } finally {
      vi.useRealTimers()
    }
  })

  it("shares one refresh between concurrent callers", async () => {
    server.on("GET", "/api/auth/token", {
      body: { user },
      token: fakeAccessToken()
    })
    const client = createAuthClient()

    // getToken deduplicates; getUser deliberately does not, because its whole
    // job is to go and look.
    await Promise.all(Array.from({ length: 5 }, () => client.getToken()))

    expect(
      server.requests.filter((request) => request.path === "/api/auth/token")
    ).toHaveLength(1)
  })
})
