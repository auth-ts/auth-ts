import { describe, expect, it } from "vitest"
import { verifyToken } from "../../src/jwt/verify-token"
import { issueSession } from "../../src/session/issue-session"
import { resolveSession } from "../../src/session/resolve-session"
import { createTestInternals } from "../helpers/create-test-internals"
import { readSetCookies } from "../helpers/request"
import { required } from "../helpers/required"

const REQUEST_URL = "https://app.example.com/api/auth/verify-code"

describe("issueSession", () => {
  it("sets a cookie with every security attribute and no Domain", async () => {
    const { internals, db } = await createTestInternals()
    const user = await db.upsertUser({ email: "ada@example.com" })

    const issued = await issueSession(internals, {
      user,
      headers: new Headers(),
      requestURL: REQUEST_URL
    })
    const cookie = readSetCookies(issued).get("auth-ts.refresh")

    expect(cookie?.attributes).toContain("HttpOnly")
    expect(cookie?.attributes).toContain("SameSite=Lax")
    expect(cookie?.attributes).toContain("Secure")
    // Rooted, so a page request carries it and a loader can read the session.
    expect(cookie?.attributes).toContain("Path=/")
    expect(cookie?.attributes.toLowerCase()).not.toContain("domain")
  })

  it("never puts the refresh token in the body in cookie mode", async () => {
    const { internals, db } = await createTestInternals()
    const user = await db.upsertUser({ email: "ada@example.com" })

    const issued = await issueSession(internals, {
      user,
      headers: new Headers(),
      requestURL: REQUEST_URL
    })

    expect(issued.refreshToken).toBeUndefined()
    expect(issued.accessToken).toBeTruthy()
  })

  it("returns the refresh token and no cookie in token mode", async () => {
    const { internals, db } = await createTestInternals()
    const user = await db.upsertUser({ email: "ada@example.com" })

    const issued = await issueSession(internals, {
      user,
      headers: new Headers(),
      requestURL: REQUEST_URL,
      mode: "token"
    })

    expect(issued.refreshToken).toBeTruthy()
    expect(issued.headers.getSetCookie()).toHaveLength(0)
  })

  it("stores only the hash of the token, never the token", async () => {
    const { internals, db } = await createTestInternals()
    const user = await db.upsertUser({ email: "ada@example.com" })

    const issued = await issueSession(internals, {
      user,
      headers: new Headers(),
      requestURL: REQUEST_URL,
      mode: "token"
    })
    const [stored] = db.sessions()

    expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(stored?.tokenHash).not.toBe(issued.refreshToken)
    expect(JSON.stringify(db.sessions())).not.toContain(
      issued.refreshToken as string
    )
  })

  it("stamps user agent and the client ip from proxy headers", async () => {
    // Two entries with one trusted proxy: the rightmost is what the proxy wrote.
    const { internals, db } = await createTestInternals({
      ipAddress: { trustedProxies: 1 }
    })
    const user = await db.upsertUser({ email: "ada@example.com" })
    const headers = new Headers({
      "user-agent": "TestBrowser/1.0",
      "x-forwarded-for": "9.9.9.9, 203.0.113.7"
    })

    await issueSession(internals, { user, headers, requestURL: REQUEST_URL })
    const [stored] = db.sessions()

    expect(stored?.userAgent).toBe("TestBrowser/1.0")
    expect(stored?.ipAddress).toBe("203.0.113.7")
  })

  it("relaxes Secure only on plain-http localhost", async () => {
    const { internals, db } = await createTestInternals()
    const user = await db.upsertUser({ email: "ada@example.com" })

    const issued = await issueSession(internals, {
      user,
      headers: new Headers(),
      requestURL: "http://localhost:3000/api/auth/verify-code"
    })

    expect(
      readSetCookies(issued).get("auth-ts.refresh")?.attributes
    ).not.toContain("Secure")
  })

  it("mints an access token that verifies and carries sub, type, and role", async () => {
    const { internals, db } = await createTestInternals()
    const user = await db.upsertUser({ email: "ada@example.com", type: "user" })

    const issued = await issueSession(internals, {
      user,
      headers: new Headers(),
      requestURL: REQUEST_URL
    })
    const { verificationKeys } = await internals.keys()
    const claims = await verifyToken(
      { keys: verificationKeys, algorithm: "RS256" },
      issued.accessToken
    )

    expect(claims?.sub).toBe(user.id)
    expect(claims?.type).toBe("user")
    expect(claims?.role).toBe("authenticated")
  })

  it("never puts primaryUserId in the token", async () => {
    const { internals, db } = await createTestInternals()
    const guest = await db.upsertUser({ type: "guest" })
    const real = await db.upsertUser({ email: "ada@example.com" })
    await db.upsertUser({ id: guest.id, primaryUserId: real.id })
    const converted = await db.getUser({ id: guest.id })

    const issued = await issueSession(internals, {
      user: required(converted, "converted guest"),
      headers: new Headers(),
      requestURL: REQUEST_URL
    })
    const { verificationKeys } = await internals.keys()
    const claims = await verifyToken(
      { keys: verificationKeys, algorithm: "RS256" },
      issued.accessToken
    )

    expect(claims).not.toHaveProperty("primaryUserId")
  })

  it("writes no accounts cookie when multiAccount is off", async () => {
    const { internals, db } = await createTestInternals()
    const user = await db.upsertUser({ email: "ada@example.com" })

    const issued = await issueSession(internals, {
      user,
      headers: new Headers(),
      requestURL: REQUEST_URL
    })

    expect(readSetCookies(issued).has("auth-ts.refresh.accounts")).toBe(false)
  })
})

describe("resolveSession", () => {
  it("resolves a freshly issued cookie back to its user", async () => {
    const { internals, db } = await createTestInternals()
    const user = await db.upsertUser({ email: "ada@example.com" })
    const issued = await issueSession(internals, {
      user,
      headers: new Headers(),
      requestURL: REQUEST_URL,
      mode: "token"
    })

    const headers = new Headers({
      cookie: `auth-ts.refresh=${issued.refreshToken}`
    })
    const resolved = await resolveSession(internals, headers)

    expect(resolved?.user.id).toBe(user.id)
  })

  it("accepts a bearer token, but the cookie wins when both are present", async () => {
    const { internals, db } = await createTestInternals()
    const first = await db.upsertUser({ email: "ada@example.com" })
    const second = await db.upsertUser({ email: "grace@example.com" })

    const cookieSession = await issueSession(internals, {
      user: first,
      headers: new Headers(),
      requestURL: REQUEST_URL,
      mode: "token"
    })
    const bearerSession = await issueSession(internals, {
      user: second,
      headers: new Headers(),
      requestURL: REQUEST_URL,
      mode: "token"
    })

    const bearerOnly = await resolveSession(
      internals,
      new Headers({ authorization: `Bearer ${bearerSession.refreshToken}` })
    )
    expect(bearerOnly?.user.id).toBe(second.id)

    const both = await resolveSession(
      internals,
      new Headers({
        cookie: `auth-ts.refresh=${cookieSession.refreshToken}`,
        authorization: `Bearer ${bearerSession.refreshToken}`
      })
    )
    expect(both?.user.id).toBe(first.id)
  })

  it("matches the Bearer scheme case-insensitively", async () => {
    const { internals, db } = await createTestInternals()
    const user = await db.upsertUser({ email: "ada@example.com" })
    const issued = await issueSession(internals, {
      user,
      headers: new Headers(),
      requestURL: REQUEST_URL,
      mode: "token"
    })

    const resolved = await resolveSession(
      internals,
      new Headers({ authorization: `bearer ${issued.refreshToken}` })
    )

    expect(resolved?.user.id).toBe(user.id)
  })

  it("returns null with no credential at all", async () => {
    const { internals } = await createTestInternals()
    expect(await resolveSession(internals, new Headers())).toBeNull()
  })

  it("returns null for a revoked session", async () => {
    const { internals, db } = await createTestInternals()
    const user = await db.upsertUser({ email: "ada@example.com" })
    const issued = await issueSession(internals, {
      user,
      headers: new Headers(),
      requestURL: REQUEST_URL,
      mode: "token"
    })
    const [stored] = db.sessions()
    await db.deleteSession({
      tokenHash: required(stored, "stored session").tokenHash
    })

    const headers = new Headers({
      cookie: `auth-ts.refresh=${issued.refreshToken}`
    })
    expect(await resolveSession(internals, headers)).toBeNull()
  })

  it("enforces expiry on read, without waiting for a cleanup sweep", async () => {
    const { internals, db } = await createTestInternals({
      session: { ttl: "1s" }
    })
    const user = await db.upsertUser({ email: "ada@example.com" })
    const issued = await issueSession(internals, {
      user,
      headers: new Headers(),
      requestURL: REQUEST_URL,
      mode: "token"
    })

    const [stored] = db.sessions()
    await db.upsertSession({
      ...required(stored, "stored session"),
      expiresAt: new Date(Date.now() - 1000)
    })

    const headers = new Headers({
      cookie: `auth-ts.refresh=${issued.refreshToken}`
    })
    expect(await resolveSession(internals, headers)).toBeNull()
  })

  it("refuses a session whose user no longer exists", async () => {
    const { internals, db } = await createTestInternals()
    const user = await db.upsertUser({ email: "ada@example.com" })
    const issued = await issueSession(internals, {
      user,
      headers: new Headers(),
      requestURL: REQUEST_URL,
      mode: "token"
    })

    const [stored] = db.sessions()
    await db.upsertSession({
      ...required(stored, "stored session"),
      userId: "vanished-user"
    })

    const headers = new Headers({
      cookie: `auth-ts.refresh=${issued.refreshToken}`
    })
    expect(await resolveSession(internals, headers)).toBeNull()
  })
})
