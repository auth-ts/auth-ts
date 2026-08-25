import { describe, expect, it, vi } from "vitest"
import { createTestServer } from "../helpers/create-test-server"
import {
  mintToken,
  readRefreshCookie,
  refreshCookieFor,
  request
} from "../helpers/request"
import { required } from "../helpers/required"
import { insertUser, selectRow, selectRows } from "../helpers/rows"

const guestOptions = { guest: true }

async function signInGuest(
  context: Awaited<ReturnType<typeof createTestServer>>
) {
  const response = await context.authServer.handler(
    request("POST", "/api/auth/sign-in/guest")
  )
  const refreshToken = required(readRefreshCookie(response), "refresh").value
  const body = (await response.json()) as {
    user: { id: string; type: string }
    token: string
  }

  return { refreshToken, user: body.user, token: body.token }
}

describe("guest sign-in", () => {
  it("404s unless guest is enabled, so a disabled endpoint looks absent", async () => {
    const { authServer } = await createTestServer()
    expect(
      (await authServer.handler(request("POST", "/api/auth/sign-in/guest")))
        .status
    ).toBe(404)
  })

  it("creates an identifier-less user and issues a session", async () => {
    const context = await createTestServer(guestOptions)
    const { user, refreshToken, token } = await signInGuest(context)

    expect(user.type).toBe("guest")
    expect(context.db.users()).toHaveLength(1)
    expect(context.db.users()[0]?.email).toBeNull()

    const whoami = await context.authServer.handler(
      request("GET", "/api/auth/user", {
        cookies: refreshCookieFor(refreshToken),
        token
      })
    )
    expect(((await whoami.json()) as { id: string }).id).toBe(user.id)
  })

  it("creates a separate user per guest sign-in", async () => {
    const context = await createTestServer(guestOptions)
    const first = await signInGuest(context)
    const second = await signInGuest(context)

    expect(first.user.id).not.toBe(second.user.id)
    expect(context.db.users()).toHaveLength(2)
  })

  it("is rate limited per ip", async () => {
    const context = await createTestServer({
      ...guestOptions,
      ipAddress: { trustedProxies: 1 },
      rateLimit: { guestPerIP: { max: 2, window: "10m" } }
    })
    const headers = { "x-forwarded-for": "203.0.113.7" }

    await context.authServer.handler(
      request("POST", "/api/auth/sign-in/guest", { headers })
    )
    await context.authServer.handler(
      request("POST", "/api/auth/sign-in/guest", { headers })
    )
    const third = await context.authServer.handler(
      request("POST", "/api/auth/sign-in/guest", { headers })
    )

    expect(third.status).toBe(429)
    expect(context.db.users()).toHaveLength(2)
  })
})

describe("guests and multiUser never mix", () => {
  it("refuses a guest sign-in while the browser is signed in", async () => {
    const context = await createTestServer(guestOptions)
    const { refreshToken } = await signInGuest(context)

    const refused = await context.authServer.handler(
      request("POST", "/api/auth/sign-in/guest", {
        cookies: refreshCookieFor(refreshToken)
      })
    )

    expect(refused.status).toBe(409)
    expect(((await refused.json()) as { code: string }).code).toBe(
      "guestRequiresSignOut"
    )
    expect(context.db.users()).toHaveLength(1)
  })

  it("allows a guest sign-in over a dead cookie", async () => {
    const context = await createTestServer(guestOptions)
    const { refreshToken, user } = await signInGuest(context)
    await context.db.delete({
      table: "sessions",
      where: { userId: user.id }
    })

    const response = await context.authServer.handler(
      request("POST", "/api/auth/sign-in/guest", {
        cookies: refreshCookieFor(refreshToken)
      })
    )

    expect(response.status).toBe(200)
  })

  it("leaves a guest nothing to switch to — a 404, not a special case", async () => {
    // No refusal code exists for this on purpose: sign-in/guest refusing a
    // signed-in browser means a guest can never hold parked accounts, so the
    // switch's own target lookup already answers.
    const context = await createTestServer({ guest: true, multiUser: true })
    const { token, refreshToken } = await signInGuest(context)

    const refused = await context.authServer.handler(
      request("POST", "/api/auth/users/switch", {
        body: { userId: "anyone" },
        cookies: refreshCookieFor(refreshToken),
        token
      })
    )

    expect(refused.status).toBe(404)
  })
})

describe("guest conversion", () => {
  it("upgrades the guest in place when the identifier is new, keeping every row they own", async () => {
    const context = await createTestServer(guestOptions)
    const { refreshToken, user: guest } = await signInGuest(context)
    const cookies = refreshCookieFor(refreshToken)

    await context.authServer.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" },
        cookies
      })
    )
    const verifyResponse = await context.authServer.handler(
      request("POST", "/api/auth/sign-in/code", {
        body: {
          email: "ada@example.com",
          code: required(context.sentCodes.at(-1), "code").code
        },
        cookies
      })
    )
    const body = (await verifyResponse.json()) as {
      user: { id: string; type: string; email: string }
    }

    // Same id is the whole point: rows created as a guest stay theirs, with no migration.
    expect(body.user.id).toBe(guest.id)
    expect(body.user.type).toBe("user")
    expect(body.user.email).toBe("ada@example.com")
    expect(context.db.users()).toHaveLength(1)

    // The guest session is replaced, not left beside the new one. Asked of the
    // cookie, because the guest's access token names a user who still exists
    // and stays good until it expires — that is the revocation latency every
    // token buys, not a session surviving.
    expect(context.db.sessions()).toHaveLength(1)
    const refused = await context.authServer.handler(
      request("GET", "/api/auth/token", { cookies })
    )

    expect(refused.status).toBe(200)
    expect(await refused.json()).toBeNull()
  })

  it("finds the guest from the token when no cookie reaches the route", async () => {
    // The guest to upgrade is whoever this tab thinks it is, and a client that
    // sends its bearer says so without the cookie having to travel.
    const context = await createTestServer(guestOptions)
    const { user: guest, token } = await signInGuest(context)

    await context.authServer.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    const response = await context.authServer.handler(
      request("POST", "/api/auth/sign-in/code", {
        token,
        body: {
          email: "ada@example.com",
          code: required(context.sentCodes.at(-1), "code").code
        }
      })
    )
    const body = (await response.json()) as { user: { id: string } }

    expect(body.user.id).toBe(guest.id)
    expect(context.db.users()).toHaveLength(1)
  })

  it("falls back to the cookie when the token names a session that is gone", async () => {
    const context = await createTestServer(guestOptions)
    const { refreshToken, token } = await signInGuest(context)
    const second = await signInGuest(context)

    await context.authServer.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    // The first guest's session is gone; the cookie says who this browser is
    // now, and the stale bearer must not send the sign-in somewhere else.
    await context.db.delete({
      table: "sessions",
      where: {
        tokenHash: required(
          context.db.sessions().find((row) => row.userId !== second.user.id),
          "first guest session"
        ).tokenHash
      }
    })
    expect(refreshToken).not.toBe(second.refreshToken)

    const response = await context.authServer.handler(
      request("POST", "/api/auth/sign-in/code", {
        token,
        cookies: refreshCookieFor(second.refreshToken),
        body: {
          email: "ada@example.com",
          code: required(context.sentCodes.at(-1), "code").code
        }
      })
    )
    const body = (await response.json()) as { user: { id: string } }

    expect(body.user.id).toBe(second.user.id)
  })

  it("points the guest at the existing account when the identifier is taken", async () => {
    const context = await createTestServer(guestOptions)
    const existing = await insertUser(context.db, {
      email: "ada@example.com"
    })

    const { refreshToken, user: guest } = await signInGuest(context)
    const cookies = refreshCookieFor(refreshToken)

    await context.authServer.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" },
        cookies
      })
    )
    const verifyResponse = await context.authServer.handler(
      request("POST", "/api/auth/sign-in/code", {
        body: {
          email: "ada@example.com",
          code: required(context.sentCodes.at(-1), "code").code
        },
        cookies
      })
    )
    const body = (await verifyResponse.json()) as { user: { id: string } }

    expect(body.user.id).toBe(existing.id)

    const guestRow = await selectRow(context.db, "users", { id: guest.id })
    expect(guestRow?.primaryUserId).toBe(existing.id)
    expect(guestRow?.type).toBe("guest")

    // The anonymous session does not outlive the merge: its refresh token is
    // dead, so nothing can keep acting as the guest from this browser.
    expect(context.db.sessions()).toHaveLength(1)
    expect(context.db.sessions()[0]?.userId).toBe(existing.id)
    const refused = await context.authServer.handler(
      request("GET", "/api/auth/token", { cookies })
    )

    expect(refused.status).toBe(200)
    expect(await refused.json()).toBeNull()
  })

  it("never converts a real user — signing in again just replaces the session", async () => {
    const context = await createTestServer()
    await context.authServer.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    const first = await context.authServer.handler(
      request("POST", "/api/auth/sign-in/code", {
        body: {
          email: "ada@example.com",
          code: required(context.sentCodes.at(-1), "code").code
        }
      })
    )
    const cookies = {
      ...refreshCookieFor(required(readRefreshCookie(first), "refresh").value)
    }

    await context.authServer.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "grace@example.com" },
        cookies
      })
    )
    const second = await context.authServer.handler(
      request("POST", "/api/auth/sign-in/code", {
        body: {
          email: "grace@example.com",
          code: required(context.sentCodes.at(-1), "code").code
        },
        cookies
      })
    )
    const body = (await second.json()) as { user: { email: string } }

    expect(body.user.email).toBe("grace@example.com")
    expect(context.db.users()).toHaveLength(2)
    expect(
      context.db.users().every((user) => user.primaryUserId === null)
    ).toBe(true)
  })
})

describe("account deletion", () => {
  const signIn = async (
    context: Awaited<ReturnType<typeof createTestServer>>
  ) => {
    await context.authServer.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    const response = await context.authServer.handler(
      request("POST", "/api/auth/sign-in/code", {
        body: {
          email: "ada@example.com",
          code: required(context.sentCodes.at(-1), "code").code
        }
      })
    )

    const { token } = (await response.json()) as { token: string }

    return {
      refreshToken: required(readRefreshCookie(response), "refresh").value,
      token
    }
  }

  it("deletes immediately when the session authenticated recently", async () => {
    const context = await createTestServer()
    const { refreshToken, token } = await signIn(context)

    const response = await context.authServer.handler(
      request("DELETE", "/api/auth/user", {
        cookies: refreshCookieFor(refreshToken),
        token
      })
    )

    expect(response.status).toBe(204)
    expect(context.db.users()).toHaveLength(0)
    expect(context.db.sessions()).toHaveLength(0)
    expect(
      required(readRefreshCookie(response), "cleared").attributes
    ).toContain("Max-Age=0")
  })

  it("takes the user's verification codes with them, so none outlives the address", async () => {
    // Core deletes the children itself rather than requiring ON DELETE CASCADE,
    // and a code left behind would sign the address's next owner into nothing.
    const context = await createTestServer()
    const { refreshToken, token } = await signIn(context)
    const cookies = refreshCookieFor(refreshToken)

    // An outstanding code, sent and never verified.
    await context.authServer.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" },
        cookies
      })
    )
    expect(
      await selectRows(context.db, "verifications", {
        identifier: "ada@example.com"
      })
    ).not.toEqual([])

    const response = await context.authServer.handler(
      request("DELETE", "/api/auth/user", { cookies, token })
    )

    expect(response.status).toBe(204)
    expect(
      await selectRows(context.db, "verifications", {
        identifier: "ada@example.com"
      })
    ).toEqual([])
  })

  it("takes every session of theirs, on every device, and nobody else's", async () => {
    const context = await createTestServer()
    const { refreshToken, token } = await signIn(context)
    const ada = required(
      await selectRow(context.db, "users", { email: "ada@example.com" }),
      "ada"
    )
    // A second device of Ada's, and a bystander who must be left alone.
    const session = (userId: string, tokenHash: string) =>
      context.db.insert({
        table: "sessions",
        values: {
          userId,
          tokenHash,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          userAgent: null,
          ipAddress: null,
          updatedAt: new Date()
        }
      })
    await session(ada.id, "ada-other-device")
    const grace = await insertUser(context.db, { email: "grace@example.com" })
    await session(grace.id, "grace-laptop")

    const response = await context.authServer.handler(
      request("DELETE", "/api/auth/user", {
        cookies: refreshCookieFor(refreshToken),
        token
      })
    )

    expect(response.status).toBe(204)
    expect(
      await selectRows(context.db, "sessions", { userId: ada.id })
    ).toEqual([])
    expect(
      await selectRows(context.db, "sessions", { userId: grace.id })
    ).toHaveLength(1)
    expect(await selectRow(context.db, "users", { id: ada.id })).toBeNull()
  })

  it("refuses a stale session outright, never a 2xx and never a side effect", async () => {
    const context = await createTestServer({
      user: { deleteFreshWindow: "0s" }
    })
    const { refreshToken, token } = await signIn(context)
    const before = context.sentCodes.length

    const response = await context.authServer.handler(
      request("DELETE", "/api/auth/user", {
        cookies: refreshCookieFor(refreshToken),
        token
      })
    )

    expect(response.status).toBe(403)
    expect(((await response.json()) as { code: string }).code).toBe(
      "staleSession"
    )
    expect(context.db.users()).toHaveLength(1)
    expect(context.sentCodes.length).toBe(before)
  })

  it("treats a zero-length freshness window as always requiring a code", async () => {
    // Regression: with `<=`, a session created in the same millisecond as the
    // request satisfied a zero window and deleted the account outright.
    vi.useFakeTimers()
    try {
      const context = await createTestServer({
        user: { deleteFreshWindow: "0s" }
      })
      const { refreshToken, token } = await signIn(context)

      const response = await context.authServer.handler(
        request("DELETE", "/api/auth/user", {
          cookies: refreshCookieFor(refreshToken),
          token
        })
      )

      expect(response.status).toBe(403)
      expect(context.db.users()).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("deletes immediately at the boundary of a non-zero window", async () => {
    vi.useFakeTimers()
    try {
      const context = await createTestServer({
        user: { deleteFreshWindow: "15m" }
      })
      const { refreshToken } = await signIn(context)

      vi.advanceTimersByTime(15 * 60_000 - 1)
      // Past the token's own lifetime, so the caller refreshes first — the
      // freshness window is measured from the session, not from the token.
      const fresh = await context.authServer.handler(
        request("DELETE", "/api/auth/user", {
          token: await mintToken(context.authServer, refreshToken)
        })
      )

      expect(fresh.status).toBe(204)
    } finally {
      vi.useRealTimers()
    }
  })

  it("challenges once the non-zero window has elapsed", async () => {
    vi.useFakeTimers()
    try {
      const context = await createTestServer({
        user: { deleteFreshWindow: "15m" }
      })
      const { refreshToken } = await signIn(context)

      vi.advanceTimersByTime(15 * 60_000)
      const stale = await context.authServer.handler(
        request("DELETE", "/api/auth/user", {
          token: await mintToken(context.authServer, refreshToken)
        })
      )

      expect(stale.status).toBe(403)
      expect(context.db.users()).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("completes deletion with a code from send-delete-code", async () => {
    const context = await createTestServer({
      user: { deleteFreshWindow: "0s" }
    })
    const { refreshToken, token } = await signIn(context)
    const cookies = refreshCookieFor(refreshToken)

    const sent = await context.authServer.handler(
      request("POST", "/api/auth/user/send-delete-code", { cookies, token })
    )
    expect(sent.status).toBe(200)
    const deletionCode = required(
      context.sentCodes.at(-1),
      "deletion code"
    ).code
    expect(required(context.sentCodes.at(-1), "deletion code").purpose).toBe(
      "deleteUser"
    )

    const response = await context.authServer.handler(
      request("DELETE", "/api/auth/user", {
        cookies,
        token,
        body: { code: deletionCode }
      })
    )

    expect(response.status).toBe(204)
    expect(context.db.users()).toHaveLength(0)
  })

  it("refuses a sign-in code as a deletion code", async () => {
    const context = await createTestServer({
      user: { deleteFreshWindow: "0s" }
    })
    const { refreshToken, token } = await signIn(context)
    const cookies = refreshCookieFor(refreshToken)

    // A fresh sign-in code for the same address must not authorize deletion.
    await context.authServer.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" },
        cookies
      })
    )
    const signInCode = required(context.sentCodes.at(-1), "sign-in code")
    expect(signInCode.purpose).toBe("signIn")

    const response = await context.authServer.handler(
      request("DELETE", "/api/auth/user", {
        cookies,
        token,
        body: { code: signInCode.code }
      })
    )

    expect(response.status).toBe(401)
    expect(context.db.users()).toHaveLength(1)
  })

  it("rate limits repeated calls to send-delete-code rather than a storm of email", async () => {
    vi.useFakeTimers()
    // Pinned to the start of a window: the limiter's windows are aligned to the
    // clock rather than started by the first request, so a run that straddled a
    // boundary would hand the fourth call a fresh allowance.
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"))
    try {
      const context = await createTestServer({
        user: { deleteFreshWindow: "0s" }
      })
      const { refreshToken, token } = await signIn(context)
      const cookies = refreshCookieFor(refreshToken)
      const before = context.sentCodes.length

      for (let attempt = 0; attempt < 3; attempt++) {
        await context.authServer.handler(
          request("POST", "/api/auth/user/send-delete-code", {
            cookies,
            token
          })
        )
        vi.advanceTimersByTime(61_000)
      }

      const limited = await context.authServer.handler(
        request("POST", "/api/auth/user/send-delete-code", { cookies, token })
      )

      expect(limited.status).toBe(429)
      expect(context.sentCodes.length - before).toBe(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it("refuses to delete a guest who has no way to receive a code", async () => {
    const context = await createTestServer({
      guest: true,
      user: { deleteFreshWindow: "0s" }
    })
    const { refreshToken, token } = await signInGuest(context)

    const response = await context.authServer.handler(
      request("DELETE", "/api/auth/user", {
        cookies: refreshCookieFor(refreshToken),
        token
      })
    )

    expect(response.status).toBe(409)
    expect(((await response.json()) as { code: string }).code).toBe(
      "guestCannotReceiveCode"
    )
  })
})
