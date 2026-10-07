import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createAuthClient } from "../../../src/client/core/create-auth-client"
import {
  createSessionStore,
  type SessionStorage
} from "../../../src/client/lib/session-storage"
import {
  type FakeAuthServer,
  fakeAccessToken,
  fakeAuthServer
} from "../helpers/fake-auth-server"

const origin = "https://app.example.com"
const user = {
  id: "user-1",
  type: "user",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01"
}
const credential = `session-1.${btoa("s".repeat(32))}`
const jwt = () => fakeAccessToken()
const memory = () => {
  const items = new Map<string, string>()
  const storage: SessionStorage = {
    getItem: async (key) => items.get(key) ?? null,
    setItem: async (key, value) => {
      items.set(key, value)
    },
    removeItem: async (key) => {
      items.delete(key)
    }
  }
  return { items, storage }
}
let server: FakeAuthServer
beforeEach(() => {
  server = fakeAuthServer()
})
afterEach(() => {
  server.restore()
  vi.useRealTimers()
})

describe("native session storage", () => {
  it("persists the session, sends JWTs normally, and renews after restart", async () => {
    const { items, storage } = memory()
    server.on("POST", "/api/auth/sign-in/guest", {
      token: jwt(),
      body: { user, sessionToken: credential, multiUser: true },
      setCookies: ["unrelated=ignored"]
    })
    server.on("POST", "/api/auth/token", {
      token: jwt(),
      body: { user, multiUser: true }
    })
    server.on("POST", "/api/auth/user", { body: user })
    const client = createAuthClient({
      baseURL: origin,
      sessionStorage: storage
    })
    await client.signInAsGuest()
    await client.updateUser({ name: "Ada" })
    expect(server.requests.at(-1)?.authorization).toBe(`Bearer ${jwt()}`)
    expect(
      await createAuthClient({
        baseURL: origin,
        sessionStorage: storage
      }).getToken()
    ).toBeTruthy()
    expect(server.requests.at(-1)?.authorization).toBe(`Bearer ${credential}`)
    expect(server.requests.at(-1)?.method).toBe("POST")
    expect([...items.values()].join()).not.toContain(jwt())
    expect([...items.keys()][0]).toMatch(/^[A-Za-z0-9_.-]+$/)
    for (const request of server.requests) {
      expect(request.cookie).toBeNull()
      expect(request.secFetchSite).toBeNull()
      expect(request.transport).toBe("bearer")
      expect(request.credentials).toBe("omit")
    }
  })

  it("isolates both origin and mount and leaves legacy cookies alone", async () => {
    const { storage, items } = memory()
    items.set("auth-ts.cookies", JSON.stringify({ secret: "legacy" }))
    const a = createSessionStore(storage, origin, "/api/auth")
    await a.put(user.id, credential, true, () => true)
    const b = createAuthClient({
      baseURL: "https://other.example.com",
      sessionStorage: storage
    })
    const c = createAuthClient({
      baseURL: origin,
      basePath: "/other",
      sessionStorage: storage
    })
    expect(await b.getToken()).toBeNull()
    expect(await c.getToken()).toBeNull()
    expect(server.requests).toHaveLength(0)
    expect((await a.read()).accounts[user.id]).toBe(credential)
    expect(items.has("auth-ts.cookies")).toBe(true)
  })

  it("serializes concurrent clients and conditionally removes credentials", async () => {
    const { storage } = memory()
    const a = createSessionStore(storage, origin, "/api/auth")
    const b = createSessionStore({ ...storage }, origin, "/api/auth")
    await Promise.all([
      a.put("a", "a.secret", true, () => true),
      b.put("b", "b.secret", true, () => true)
    ])
    expect((await a.read()).accounts).toEqual({ a: "a.secret", b: "b.secret" })
    await a.put("a", "new.secret", true, () => true)
    await b.remove("a", "a.secret")
    expect((await a.read()).accounts.a).toBe("new.secret")
    await a.remove("b", "b.secret")
    expect((await a.read()).accounts).toEqual({ a: "new.secret" })
  })

  it("clears only a refused credential and preserves network-failed sessions", async () => {
    const { storage } = memory()
    const store = createSessionStore(storage, origin, "/api/auth")
    await store.put(user.id, credential, false, () => true)
    server.on("POST", "/api/auth/token", { networkError: true })
    const client = createAuthClient({
      baseURL: origin,
      sessionStorage: storage
    })
    await expect(client.getToken()).rejects.toThrow()
    expect((await store.read()).accounts[user.id]).toBe(credential)
    server.on("POST", "/api/auth/token", {
      status: 401,
      body: { code: "unauthenticated" }
    })
    expect(await client.getToken()).toBeNull()
    expect((await store.read()).accounts).toEqual({})
  })

  it.each(["success", "null", "unauthenticated"])(
    "ignores a superseded %s refresh",
    async (outcome) => {
      const { storage } = memory()
      const store = createSessionStore(storage, origin, "/api/auth")
      server.on("POST", "/api/auth/sign-in/guest", {
        token: jwt(),
        body: { user, sessionToken: credential, multiUser: true }
      })
      const client = createAuthClient({
        baseURL: origin,
        sessionStorage: storage
      })
      await client.signInAsGuest()
      let release = () => {}
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      let entered = () => {}
      const started = new Promise<void>((resolve) => {
        entered = resolve
      })
      const bUser = { ...user, id: "b" }
      const bJwt = fakeAccessToken({ userId: "b", sessionId: "b-session" })
      const bCredential = `b-session.${btoa("b".repeat(32))}`
      vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
        if (String(url).endsWith("/token")) {
          entered()
          await gate
          return outcome === "success"
            ? Response.json({ token: jwt(), user })
            : outcome === "null"
              ? Response.json(null)
              : Response.json({ code: "unauthenticated" }, { status: 401 })
        }
        return Response.json({
          token: bJwt,
          user: bUser,
          sessionToken: bCredential,
          multiUser: true
        })
      })
      const pending = client.refresh()
      await started
      await client.signInWithCode({ code: "123456", attempt: "attempt" })
      release()
      expect(await pending).toBeNull()
      expect(await client.getToken()).toBe(bJwt)
      expect((await store.read()).accounts.b).toBe(bCredential)
    }
  )

  it("refuses native provider navigation before sending requests", async () => {
    const { storage } = memory()
    const client = createAuthClient({
      baseURL: origin,
      sessionStorage: storage
    })
    await expect(
      client.signInWithProvider({ provider: "google" })
    ).rejects.toThrow(/not supported/)
    expect(server.requests).toHaveLength(0)
  })
})

it.each(["success", "null", "unauthenticated"])(
  "never dispatches a superseded browser mutation after %s",
  async (outcome) => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered = () => {}
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const bJwt = fakeAccessToken({ userId: "b", sessionId: "b-session" })
    const mutations: string[] = []
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url).endsWith("/token")) {
        entered()
        await gate
        return outcome === "success"
          ? Response.json({ token: jwt(), user })
          : outcome === "null"
            ? Response.json(null)
            : Response.json({ code: "unauthenticated" }, { status: 401 })
      }
      if (String(url).endsWith("/user")) {
        mutations.push(new Headers(init?.headers).get("authorization") ?? "")
        return Response.json(user)
      }
      return Response.json({ token: bJwt, user: { ...user, id: "b" } })
    })
    const client = createAuthClient()
    const pending = client.updateUser({ name: "superseded" })
    const rejected = expect(pending).rejects.toMatchObject({
      code: "unauthenticated"
    })
    await started
    await client.signInWithCode({ code: "123456" })
    release()
    await rejected
    expect(mutations).toEqual([])
    expect(await client.getToken()).toBe(bJwt)
  }
)
