import { describe, expect, it } from "vitest"
import { verifyToken } from "../../src/jwt/verify-token"
import { issueSession } from "../../src/session/issue-session"
import {
  resolveCallerSession,
  resolveSession
} from "../../src/session/resolve-session"
import { createTestInternals } from "../helpers/create-test-internals"
import { readSetCookies } from "../helpers/request"
import { required } from "../helpers/required"
import { insertUser, selectRow, selectRows } from "../helpers/rows"

const REQUEST_URL = "https://app.example.com/api/auth/verify-code"

const refreshTokenOf = (issued: { headers: Headers }) =>
  required(readSetCookies(issued).get("auth-ts.refresh"), "refresh cookie")
    .value

describe("issueSession", () => {
  it("sets a cookie with every security attribute and no Domain", async () => {
    const { internals, db } = await createTestInternals()
    const user = await insertUser(db, { email: "ada@example.com" })

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

  it("writes the readable hint beside the cookie, expiring together", async () => {
    const { internals, db } = await createTestInternals()
    const user = await insertUser(db, { email: "ada@example.com" })

    const issued = await issueSession(internals, {
      user,
      headers: new Headers(),
      requestURL: REQUEST_URL
    })
    const cookies = readSetCookies(issued)
    const hint = required(cookies.get("auth-ts.hint"), "hint cookie")

    expect(hint.value).toBe("in")
    // The one cookie script may read, because it is the one that is not a
    // credential — and useless if a page cannot see it.
    expect(hint.attributes).not.toContain("HttpOnly")
    expect(hint.attributes).toContain("Path=/")
    expect(hint.attributes.toLowerCase()).not.toContain("domain")
    expect(hint.attributes).toContain(
      required(
        cookies.get("auth-ts.refresh"),
        "refresh cookie"
      ).attributes.match(/Max-Age=\d+/)?.[0]
    )
  })

  it("scopes the hint to the shared domain only when a cross-origin app is configured", async () => {
    const cross = await createTestInternals({
      cors: { origin: "https://app.example.com" }
    })
    const issuedCross = await issueSession(cross.internals, {
      user: await insertUser(cross.db, { email: "ada@example.com" }),
      headers: new Headers(),
      requestURL: "https://api.example.com/api/auth/verify-code"
    })

    expect(
      required(readSetCookies(issuedCross).get("auth-ts.hint"), "hint")
        .attributes
    ).toContain("Domain=example.com")

    // A public suffix would be refused by the browser anyway; a single shared
    // label is never a domain a cookie may claim.
    const tld = await createTestInternals({
      cors: { origin: "https://app.example" }
    })
    const issuedTld = await issueSession(tld.internals, {
      user: await insertUser(tld.db, { email: "ada@example.com" }),
      headers: new Headers(),
      requestURL: "https://api.other.example/api/auth/verify-code"
    })

    expect(
      required(
        readSetCookies(issuedTld).get("auth-ts.hint"),
        "hint"
      ).attributes.toLowerCase()
    ).not.toContain("domain")
  })

  it("stores only the hash of the token, never the token", async () => {
    const { internals, db } = await createTestInternals()
    const user = await insertUser(db, { email: "ada@example.com" })

    const issued = await issueSession(internals, {
      user,
      headers: new Headers(),
      requestURL: REQUEST_URL
    })
    const refreshToken = refreshTokenOf(issued)
    const [stored] = db.sessions()

    expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(stored?.tokenHash).not.toBe(refreshToken)
    expect(JSON.stringify(db.sessions())).not.toContain(refreshToken)
  })

  it("stamps user agent and the client ip from proxy headers", async () => {
    // Two entries with one trusted proxy: the rightmost is what the proxy wrote.
    const { internals, db } = await createTestInternals({
      ipAddress: { trustedProxies: 1 }
    })
    const user = await insertUser(db, { email: "ada@example.com" })
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
    const user = await insertUser(db, { email: "ada@example.com" })

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
    const user = await insertUser(db, {
      email: "ada@example.com",
      type: "user"
    })

    const issued = await issueSession(internals, {
      user,
      headers: new Headers(),
      requestURL: REQUEST_URL
    })
    const { verificationKeys } = await internals.keys()
    const claims = await verifyToken(
      { keys: verificationKeys, algorithm: "RS256" },
      issued.token
    )

    expect(claims?.sub).toBe(user.id)
    expect(claims?.type).toBe("user")
    expect(claims?.role).toBe("authenticated")
  })

  it("never puts primaryUserId in the token", async () => {
    const { internals, db } = await createTestInternals()
    const guest = await insertUser(db, { type: "guest" })
    const real = await insertUser(db, { email: "ada@example.com" })
    await db.update({
      table: "users",
      where: { id: guest.id },
      values: { primaryUserId: real.id }
    })
    const converted = await selectRow(db, "users", { id: guest.id })

    const issued = await issueSession(internals, {
      user: required(converted, "converted guest"),
      headers: new Headers(),
      requestURL: REQUEST_URL
    })
    const { verificationKeys } = await internals.keys()
    const claims = await verifyToken(
      { keys: verificationKeys, algorithm: "RS256" },
      issued.token
    )

    expect(claims).not.toHaveProperty("primaryUserId")
  })

  it("writes no accounts cookie when multiAccount is off", async () => {
    const { internals, db } = await createTestInternals()
    const user = await insertUser(db, { email: "ada@example.com" })

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
    const user = await insertUser(db, { email: "ada@example.com" })
    const issued = await issueSession(internals, {
      user,
      headers: new Headers(),
      requestURL: REQUEST_URL
    })

    const headers = new Headers({
      cookie: `auth-ts.refresh=${refreshTokenOf(issued)}`
    })
    const resolved = await resolveSession(internals, headers)

    expect(resolved?.user.id).toBe(user.id)
  })

  it("ignores a refresh token presented as a bearer: the cookie is its only carrier", async () => {
    const { internals, db } = await createTestInternals()
    const user = await insertUser(db, { email: "ada@example.com" })
    const issued = await issueSession(internals, {
      user,
      headers: new Headers(),
      requestURL: REQUEST_URL
    })

    const resolved = await resolveSession(
      internals,
      new Headers({ authorization: `Bearer ${refreshTokenOf(issued)}` })
    )

    expect(resolved).toBeNull()
  })

  it("returns null with no credential at all", async () => {
    const { internals } = await createTestInternals()
    expect(await resolveSession(internals, new Headers())).toBeNull()
  })

  it("returns null for a revoked session", async () => {
    const { internals, db } = await createTestInternals()
    const user = await insertUser(db, { email: "ada@example.com" })
    const issued = await issueSession(internals, {
      user,
      headers: new Headers(),
      requestURL: REQUEST_URL
    })
    const [stored] = db.sessions()
    await db.delete({
      table: "sessions",
      where: { tokenHash: required(stored, "stored session").tokenHash }
    })

    const headers = new Headers({
      cookie: `auth-ts.refresh=${refreshTokenOf(issued)}`
    })
    expect(await resolveSession(internals, headers)).toBeNull()
  })

  it("enforces expiry on read, without waiting for a cleanup sweep", async () => {
    const { internals, db } = await createTestInternals({
      session: { ttl: "1s" }
    })
    const user = await insertUser(db, { email: "ada@example.com" })
    const issued = await issueSession(internals, {
      user,
      headers: new Headers(),
      requestURL: REQUEST_URL
    })

    const [stored] = db.sessions()
    await db.update({
      table: "sessions",
      where: { id: required(stored, "stored session").id },
      values: { expiresAt: new Date(Date.now() - 1000) }
    })

    const headers = new Headers({
      cookie: `auth-ts.refresh=${refreshTokenOf(issued)}`
    })
    expect(await resolveSession(internals, headers)).toBeNull()
  })

  it("refuses an expired session without extending it", async () => {
    // The row is found and touched by one statement, and an expiry already past
    // matches nothing — so the write that records activity on a live session
    // can never revive a dead one. Removing the row is the sweep's job.
    const { internals, db } = await createTestInternals({
      session: { ttl: "1s" }
    })
    const user = await insertUser(db, { email: "ada@example.com" })
    const issued = await issueSession(internals, {
      user,
      headers: new Headers(),
      requestURL: REQUEST_URL
    })

    const [stored] = db.sessions()
    await db.update({
      table: "sessions",
      where: { id: required(stored, "stored session").id },
      values: { expiresAt: new Date(Date.now() - 1000) }
    })

    const resolved = await resolveSession(
      internals,
      new Headers({ cookie: `auth-ts.refresh=${refreshTokenOf(issued)}` })
    )

    expect(resolved).toBeNull()
    const [after] = await selectRows(db, "sessions")
    expect(required(after, "session").expiresAt.getTime()).toBeLessThan(
      Date.now()
    )
  })

  it("refuses a session whose user no longer exists", async () => {
    const { internals, db } = await createTestInternals()
    const user = await insertUser(db, { email: "ada@example.com" })
    const issued = await issueSession(internals, {
      user,
      headers: new Headers(),
      requestURL: REQUEST_URL
    })

    const [stored] = db.sessions()
    await db.update({
      table: "sessions",
      where: { id: required(stored, "stored session").id },
      values: { userId: "vanished-user" }
    })

    const headers = new Headers({
      cookie: `auth-ts.refresh=${refreshTokenOf(issued)}`
    })
    expect(await resolveSession(internals, headers)).toBeNull()
  })
})

describe("resolveCallerSession", () => {
  const signedIn = async () => {
    const { internals, db } = await createTestInternals()
    const user = await insertUser(db, { email: "ada@example.com" })
    const issued = await issueSession(internals, {
      user,
      headers: new Headers(),
      requestURL: REQUEST_URL
    })

    return {
      internals,
      db,
      user,
      token: issued.token,
      cookie: new Headers({
        cookie: `auth-ts.refresh=${refreshTokenOf(issued)}`
      })
    }
  }

  it("reads the session the token names, without touching it", async () => {
    const { internals, db, user, token } = await signedIn()
    const before = required(db.sessions()[0], "session").updatedAt

    const resolved = await resolveCallerSession(internals, { token })

    expect(resolved?.user.id).toBe(user.id)
    expect(required(db.sessions()[0], "session").updatedAt).toEqual(before)
  })

  it("falls back to the cookie when the token names a session that is gone", async () => {
    // The bearer outlives the row it names by up to `jwt.ttl`, so a browser
    // that signed in again elsewhere must not be told it has no session.
    const { internals, db, token, cookie } = await signedIn()
    const other = await insertUser(db, { email: "grace@example.com" })
    const reissued = await issueSession(internals, {
      user: other,
      headers: new Headers(),
      requestURL: REQUEST_URL
    })
    await db.delete({
      table: "sessions",
      where: { userId: required(db.users()[0], "ada").id }
    })

    const headers = new Headers({
      cookie: `auth-ts.refresh=${refreshTokenOf(reissued)}`,
      authorization: `Bearer ${token}`
    })
    const resolved = await resolveCallerSession(internals, { headers })

    expect(resolved?.user.id).toBe(other.id)
    expect(cookie.get("cookie")).toBeTruthy()
  })

  it("falls back to the cookie when there is no token at all", async () => {
    const { internals, user, cookie } = await signedIn()

    expect(
      (await resolveCallerSession(internals, { headers: cookie }))?.user.id
    ).toBe(user.id)
  })

  it("returns null when neither credential resolves", async () => {
    const { internals } = await createTestInternals()

    expect(await resolveCallerSession(internals, {})).toBeNull()
    expect(
      await resolveCallerSession(internals, { headers: new Headers() })
    ).toBeNull()
  })
})
