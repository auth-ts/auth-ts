import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createAuthClient } from "../../src/core/create-auth-client"
import type { CookieStorage } from "../../src/lib/cookie-jar"
import { createCookieJar } from "../../src/lib/cookie-jar"
import type { FakeAuthServer } from "../helpers/fake-auth-server"
import { fakeAccessToken, fakeAuthServer } from "../helpers/fake-auth-server"

const user = { id: "user-1", email: "ada@example.com", type: "user" as const }

/** An in-memory stand-in for a keychain: the shape is all the client needs. */
function memoryStorage() {
  const items = new Map<string, string>()
  const storage: CookieStorage = {
    getItem: async (key) => items.get(key) ?? null,
    setItem: async (key, value) => {
      items.set(key, value)
    },
    removeItem: async (key) => {
      items.delete(key)
    }
  }

  return { storage, items }
}

let server: FakeAuthServer

beforeEach(() => {
  server = fakeAuthServer()
})

afterEach(() => {
  server.restore()
})

describe("cookieStorage", () => {
  it("leaves the browser's jar alone when unset", async () => {
    server.on("GET", "/api/auth/token", {
      body: { user },
      token: fakeAccessToken()
    })

    await createAuthClient().refresh()

    expect(server.requests[0]?.credentials).toBe("include")
    expect(server.requests[0]?.cookie).toBeNull()
  })

  it("keeps what the server sets and sends it back, with credentials omitted", async () => {
    const { storage, items } = memoryStorage()
    server.on("POST", "/api/auth/sign-in/code", {
      body: { user },
      token: fakeAccessToken(),
      setCookies: [
        "auth-ts.refresh=secret; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax"
      ]
    })
    server.on("GET", "/api/auth/users", { body: [user] })
    const client = createAuthClient({ cookieStorage: storage })

    await client.signInWithCode({ email: "ada@example.com", code: "123456" })
    await client.listUsers()

    expect(server.requests[0]?.credentials).toBe("omit")
    expect(server.requests[0]?.cookie).toBeNull()
    expect(server.requests[1]?.cookie).toBe("auth-ts.refresh=secret")
    expect(items.get("auth-ts.cookies")).toBe(
      JSON.stringify({ "auth-ts.refresh": "secret" })
    )
  })

  it("drops a cookie the server clears", async () => {
    const { storage, items } = memoryStorage()
    await storage.setItem(
      "auth-ts.cookies",
      JSON.stringify({ "auth-ts.refresh": "secret", other: "kept" })
    )
    // The jar carries the refresh cookie to `/token`, which is the one place
    // it is spent — and the token it buys is what signs the caller out.
    server.on("GET", "/api/auth/token", {
      body: { user },
      token: fakeAccessToken()
    })
    server.on("POST", "/api/auth/sign-out", {
      status: 204,
      setCookies: [
        "auth-ts.refresh=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax"
      ]
    })
    const client = createAuthClient({ cookieStorage: storage })

    await client.signOut()

    expect(server.requests[0]?.path).toBe("/api/auth/token")
    expect(server.requests[0]?.credentials).toBe("omit")
    expect(server.requests[0]?.cookie).toBe(
      "auth-ts.refresh=secret; other=kept"
    )
    expect(items.get("auth-ts.cookies")).toBe(JSON.stringify({ other: "kept" }))
  })

  it("removes the entry entirely once nothing is left", async () => {
    const { storage, items } = memoryStorage()
    await storage.setItem(
      "auth-ts.cookies",
      JSON.stringify({ "auth-ts.refresh": "secret" })
    )
    server.on("GET", "/api/auth/token", {
      body: { user },
      token: fakeAccessToken()
    })
    server.on("POST", "/api/auth/sign-out", {
      status: 204,
      setCookies: ["auth-ts.refresh=; Max-Age=0; Path=/"]
    })

    await createAuthClient({ cookieStorage: storage }).signOut()

    expect(items.has("auth-ts.cookies")).toBe(false)
  })

  it("treats unreadable storage as empty rather than failing the request", async () => {
    const { storage } = memoryStorage()
    await storage.setItem("auth-ts.cookies", "not json")
    server.on("GET", "/api/auth/token", {
      body: { user },
      token: fakeAccessToken()
    })

    await createAuthClient({ cookieStorage: storage }).refresh()

    expect(server.requests[0]?.cookie).toBeNull()
  })

  it("empties the jar when the refresh cookie is refused", async () => {
    const { storage, items } = memoryStorage()
    await storage.setItem(
      "auth-ts.cookies",
      JSON.stringify({ "auth-ts.refresh": "spent" })
    )
    server.on("GET", "/api/auth/token", {
      status: 401,
      body: { code: "unauthenticated", message: "You are not signed in." }
    })

    expect(
      await createAuthClient({ cookieStorage: storage }).refresh()
    ).toBeNull()

    // A jar holding a refused refresh token is holding a dead credential.
    expect(items.has("auth-ts.cookies")).toBe(false)
  })
})

describe("createCookieJar", () => {
  it("splits a folded Set-Cookie header without breaking on an Expires date", async () => {
    const { storage, items } = memoryStorage()
    const jar = createCookieJar(storage)
    const headers = new Headers()
    headers.set(
      "set-cookie",
      "a=1; Expires=Wed, 21 Oct 2015 07:28:00 GMT; Path=/, b=2; Path=/"
    )
    // A runtime without `getSetCookie` is what folds them in the first place.
    Object.defineProperty(headers, "getSetCookie", { value: undefined })

    await jar.absorb({ headers })

    expect(JSON.parse(items.get("auth-ts.cookies") ?? "{}")).toEqual({
      a: "1",
      b: "2"
    })
  })

  it("answers no header at all for an empty jar", async () => {
    const { storage } = memoryStorage()

    expect(await createCookieJar(storage).header()).toBeUndefined()
  })
})
