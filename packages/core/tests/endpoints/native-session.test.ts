import { afterEach, describe, expect, it, vi } from "vitest"
import type { AuthClient } from "../../src/client/core/create-auth-client"
import { createAuthClient } from "../../src/client/core/create-auth-client"
import {
  createSessionStore,
  type SessionStorage
} from "../../src/client/lib/session-storage"
import {
  createTestServer,
  type TestServer
} from "../helpers/create-test-server"
import {
  readRefreshCookie,
  refreshCookieFor,
  request
} from "../helpers/request"

const origin = "https://app.example.com"
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
const code = (context: TestServer) => {
  const last = context.sentCodes.at(-1)
  if (!last) throw new Error("No verification code delivered")
  return last.code
}
async function signIn(context: TestServer, client: AuthClient, email: string) {
  await client.sendSignInCode({ email })
  return client.signInWithCode({ code: code(context) })
}
function connect(context: TestServer) {
  const seen: Request[] = []
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const incoming = new Request(String(url), init)
    seen.push(incoming.clone())
    return context.auth.handler(incoming)
  })
  return seen
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("native bearer sessions", () => {
  it("uses POST and leaves browser secrets in cookies", async () => {
    const context = await createTestServer({ guest: true })
    const signedIn = await context.auth.handler(
      request("POST", "/api/auth/sign-in/guest")
    )
    const browser = (await signedIn.json()) as {
      token: string
      user: { id: string }
      sessionToken?: string
    }
    expect(browser.sessionToken).toBeUndefined()
    const cookie = readRefreshCookie(signedIn)?.value
    if (!cookie) throw new Error("No browser cookie")
    const old = await context.auth.handler(request("GET", "/api/auth/token"))
    expect(old.status).toBe(405)
    expect(old.headers.get("allow")).toBe("POST")
    const valid = await context.auth.handler(
      request("POST", "/api/auth/token", {
        cookies: refreshCookieFor(cookie, browser.user.id)
      })
    )
    expect(valid.status).toBe(200)
    expect(valid.headers.get("cache-control")).toContain("no-store")
    const rejected = await context.auth.handler(
      new Request(`${origin}/api/auth/token`, {
        method: "POST",
        headers: {
          cookie: `__Host-auth-ts.refresh.${browser.user.id}=${encodeURIComponent(cookie)}`
        }
      })
    )
    expect(rejected.status).toBe(403)
    expect(
      await context.auth.getToken({
        headers: new Headers({
          cookie: `__Host-auth-ts.refresh.${browser.user.id}=${encodeURIComponent(cookie)}`
        })
      })
    ).not.toBeNull()
  })

  it("does not use cookies or access JWTs as native renewal credentials", async () => {
    const context = await createTestServer({
      guest: true,
      cookie: { path: "/api/auth" }
    })
    const browser = await context.auth.handler(
      request("POST", "/api/auth/sign-in/guest")
    )
    const data = (await browser.json()) as {
      token: string
      user: { id: string }
    }
    const cookie = readRefreshCookie(browser)?.value
    if (!cookie) throw new Error("No cookie")
    for (const bearer of [
      undefined,
      data.token,
      "invalid.credential",
      `missing.${btoa("x".repeat(32))}`
    ]) {
      const headers = new Headers({
        "x-auth-transport": "bearer",
        cookie: `auth-ts.refresh.${data.user.id}=${encodeURIComponent(cookie)}`
      })
      if (bearer) headers.set("authorization", `Bearer ${bearer}`)
      const response = await context.auth.handler(
        new Request(`${origin}/api/auth/token`, { method: "POST", headers })
      )
      expect(response.status).toBe(401)
      expect(response.headers.has("set-cookie")).toBe(false)
    }
    expect(context.db.sessions()).toHaveLength(1)
  })

  it("refuses untrusted origins, invalid transports and non-JSON bodies", async () => {
    const context = await createTestServer({ guest: true })
    for (const [headers, body, status] of [
      [
        { "x-auth-transport": "bearer", origin: "https://evil.example" },
        undefined,
        403
      ],
      [{ "x-auth-transport": "unknown" }, undefined, 400],
      [
        { "x-auth-transport": "bearer", "content-type": "text/plain" },
        "{}",
        415
      ],
      [
        { "x-auth-transport": "bearer", "content-type": "application/json" },
        '{"sessionToken":"injected"}',
        400
      ]
    ] as const) {
      const response = await context.auth.handler(
        new Request(`${origin}/api/auth/sign-in/guest`, {
          method: "POST",
          headers,
          body
        })
      )
      expect(response.status).toBe(status)
    }
    expect(context.db.users()).toHaveLength(0)
  })

  it("keeps guest identity through code sign-in and renews after JWT expiry", async () => {
    const context = await createTestServer({ guest: true })
    const seen = connect(context)
    const { storage, items } = memory()
    const client = createAuthClient({
      baseURL: origin,
      sessionStorage: storage
    })
    const guest = await client.signInAsGuest()
    await expect(client.signInAsGuest()).rejects.toMatchObject({
      code: "guestRequiresSignOut"
    })
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(Date.now() + 61 * 60_000)
    const signedIn = await signIn(context, client, "ada@example.com")
    expect(signedIn.user.id).toBe(guest.user.id)
    expect(signedIn.user.type).toBe("user")
    expect(context.db.sessions()).toHaveLength(1)
    const restarted = createAuthClient({
      baseURL: origin,
      sessionStorage: storage
    })
    expect(await restarted.getToken()).toBeTruthy()
    for (const incoming of seen) {
      expect(incoming.headers.has("cookie")).toBe(false)
      expect(incoming.headers.has("sec-fetch-site")).toBe(false)
    }
    const text = [...items.values()].join()
    expect(text).not.toContain(signedIn.token)
    for (const call of context.logCalls)
      expect(JSON.stringify(call)).not.toContain(
        (await createSessionStore(storage, origin, "/api/auth").read())
          .accounts[signedIn.user.id]
      )
    await restarted.signOut()
    expect(context.db.sessions()).toHaveLength(0)
    expect(await restarted.getToken()).toBeNull()
  })

  it("retains, lists, switches and revokes native accounts independently", async () => {
    const context = await createTestServer({ multiUser: true })
    connect(context)
    const { storage } = memory()
    const client = createAuthClient({
      baseURL: origin,
      sessionStorage: storage
    })
    const ada = await signIn(context, client, "ada@example.com")
    const bob = await signIn(context, client, "bob@example.com")
    expect((await client.listUsers()).map((user) => user.id).sort()).toEqual(
      [ada.user.id, bob.user.id].sort()
    )
    expect(
      client.decodeToken((await client.getToken()) ?? "")?.claims.sub
    ).toBe(bob.user.id)
    await client.switchUser({ userId: ada.user.id })
    expect(
      client.decodeToken((await client.getToken()) ?? "")?.claims.sub
    ).toBe(ada.user.id)
    await client.signOut({ userId: bob.user.id })
    expect((await client.listUsers()).map((user) => user.id)).toEqual([
      ada.user.id
    ])
    expect(context.db.sessions()).toHaveLength(1)
    await client.signOut()
    expect(context.db.sessions()).toHaveLength(0)
    expect(await client.getToken()).toBeNull()
  })

  it("honors single-account replacement and global revocation", async () => {
    const context = await createTestServer()
    connect(context)
    const { storage } = memory()
    const client = createAuthClient({
      baseURL: origin,
      sessionStorage: storage
    })
    await signIn(context, client, "ada@example.com")
    const bob = await signIn(context, client, "bob@example.com")
    expect(context.db.sessions()).toHaveLength(1)
    expect(
      Object.keys(
        (await createSessionStore(storage, origin, "/api/auth").read()).accounts
      )
    ).toEqual([bob.user.id])
    const second = createAuthClient({
      baseURL: origin,
      sessionStorage: memory().storage
    })
    await signIn(context, second, "bob@example.com")
    expect(context.db.sessions()).toHaveLength(2)
    await client.signOut({ scope: "global" })
    expect(context.db.sessions()).toHaveLength(0)
    expect(await second.refresh()).toBeNull()
  })

  it("carries identity and identifier attempts without cookies", async () => {
    const context = await createTestServer({ multiUser: true })
    connect(context)
    const client = createAuthClient({
      baseURL: origin,
      sessionStorage: memory().storage
    })
    const ada = await signIn(context, client, "ada@example.com")
    expect(await client.deleteUser()).toEqual({
      status: "verificationRequired"
    })
    await client.sendIdentityCode()
    await client.verifyIdentity({ code: code(context) })
    expect(
      await client.sendEmailUpdateCode({ email: "new@example.com" })
    ).toMatchObject({ status: "sent" })
    expect(
      await client.verifyEmailUpdate({ code: code(context) })
    ).toMatchObject({ status: "updated", user: { email: "new@example.com" } })
    await signIn(context, client, "bob@example.com")
    expect(await client.deleteUser()).toEqual({
      status: "verificationRequired"
    })
    await client.switchUser({ userId: ada.user.id })
    expect(await client.deleteUser()).toEqual({
      status: "verificationRequired"
    })
    await client.sendIdentityCode()
    await client.verifyIdentity({ code: code(context) })
    const other = createAuthClient({
      baseURL: origin,
      sessionStorage: memory().storage
    })
    await signIn(context, other, "new@example.com")
    const currentSession = client.decodeToken((await client.getToken()) ?? "")
      ?.claims.sid
    const session = context.db
      .sessions()
      .find((row) => row.userId === ada.user.id && row.id !== currentSession)
    if (!session) throw new Error("No second session")
    expect(await client.revokeSession({ id: session.id })).toEqual({
      status: "revoked"
    })
    expect(await other.refresh()).toBeNull()
    expect(await client.deleteUser()).toEqual({ status: "deleted" })
    expect(context.db.users().some((user) => user.id === ada.user.id)).toBe(
      false
    )
    expect((await client.listUsers()).map((user) => user.email)).toEqual([
      "bob@example.com"
    ])
  })
})
