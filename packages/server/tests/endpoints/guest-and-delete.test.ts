import { describe, expect, it, vi } from "vitest"
import { createTestServer } from "../helpers/create-test-server.ts"
import { readSetCookies, request } from "../helpers/request.ts"
import { required } from "../helpers/required.ts"

const guestOptions = { guest: true }

async function signInAsGuest(
  context: Awaited<ReturnType<typeof createTestServer>>
) {
  const response = await context.authServer.handler(
    request("POST", "/api/auth/sign-in/guest")
  )
  const refreshToken = required(
    readSetCookies(response).get("auth-ts.refresh"),
    "refresh"
  ).value
  const body = (await response.json()) as { user: { id: string; type: string } }

  return { refreshToken, user: body.user }
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
    const { user, refreshToken } = await signInAsGuest(context)

    expect(user.type).toBe("guest")
    expect(context.db.users()).toHaveLength(1)
    expect(context.db.users()[0]?.email).toBeNull()

    const whoami = await context.authServer.handler(
      request("GET", "/api/auth/user", {
        cookies: { "auth-ts.refresh": refreshToken }
      })
    )
    expect(((await whoami.json()) as { user: { id: string } }).user.id).toBe(
      user.id
    )
  })

  it("creates a separate user per guest sign-in", async () => {
    const context = await createTestServer(guestOptions)
    const first = await signInAsGuest(context)
    const second = await signInAsGuest(context)

    expect(first.user.id).not.toBe(second.user.id)
    expect(context.db.users()).toHaveLength(2)
  })

  it("is rate limited per ip", async () => {
    const context = await createTestServer({
      ...guestOptions,
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

describe("guest conversion", () => {
  it("upgrades the guest in place when the identifier is new, keeping every row they own", async () => {
    const context = await createTestServer(guestOptions)
    const { refreshToken, user: guest } = await signInAsGuest(context)
    const cookies = { "auth-ts.refresh": refreshToken }

    await context.authServer.handler(
      request("POST", "/api/auth/send-code", {
        body: { email: "ada@example.com" },
        cookies
      })
    )
    const verifyResponse = await context.authServer.handler(
      request("POST", "/api/auth/verify-code", {
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
  })

  it("points the guest at the existing account when the identifier is taken", async () => {
    const context = await createTestServer(guestOptions)
    const existing = await context.db.upsertUser({
      email: "ada@example.com",
      type: "user"
    })

    const { refreshToken, user: guest } = await signInAsGuest(context)
    const cookies = { "auth-ts.refresh": refreshToken }

    await context.authServer.handler(
      request("POST", "/api/auth/send-code", {
        body: { email: "ada@example.com" },
        cookies
      })
    )
    const verifyResponse = await context.authServer.handler(
      request("POST", "/api/auth/verify-code", {
        body: {
          email: "ada@example.com",
          code: required(context.sentCodes.at(-1), "code").code
        },
        cookies
      })
    )
    const body = (await verifyResponse.json()) as { user: { id: string } }

    expect(body.user.id).toBe(existing.id)

    const guestRow = await context.db.getUser({ id: guest.id })
    expect(guestRow?.primaryUserId).toBe(existing.id)
    expect(guestRow?.type).toBe("guest")
  })

  it("never converts a real user — signing in again just replaces the session", async () => {
    const context = await createTestServer()
    await context.authServer.handler(
      request("POST", "/api/auth/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    const first = await context.authServer.handler(
      request("POST", "/api/auth/verify-code", {
        body: {
          email: "ada@example.com",
          code: required(context.sentCodes.at(-1), "code").code
        }
      })
    )
    const cookies = {
      "auth-ts.refresh": required(
        readSetCookies(first).get("auth-ts.refresh"),
        "refresh"
      ).value
    }

    await context.authServer.handler(
      request("POST", "/api/auth/send-code", {
        body: { email: "grace@example.com" },
        cookies
      })
    )
    const second = await context.authServer.handler(
      request("POST", "/api/auth/verify-code", {
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
      request("POST", "/api/auth/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    const response = await context.authServer.handler(
      request("POST", "/api/auth/verify-code", {
        body: {
          email: "ada@example.com",
          code: required(context.sentCodes.at(-1), "code").code
        }
      })
    )

    return required(readSetCookies(response).get("auth-ts.refresh"), "refresh")
      .value
  }

  it("deletes immediately when the session authenticated recently", async () => {
    const context = await createTestServer()
    const refreshToken = await signIn(context)

    const response = await context.authServer.handler(
      request("DELETE", "/api/auth/user", {
        cookies: { "auth-ts.refresh": refreshToken }
      })
    )

    expect(response.status).toBe(204)
    expect(context.db.users()).toHaveLength(0)
    expect(context.db.sessions()).toHaveLength(0)
    expect(
      required(readSetCookies(response).get("auth-ts.refresh"), "cleared")
        .attributes
    ).toContain("Max-Age=0")
  })

  it("challenges a stale session with a code and answers 403, never a 2xx", async () => {
    const context = await createTestServer({
      user: { deleteFreshWindow: "0s" }
    })
    const refreshToken = await signIn(context)

    const response = await context.authServer.handler(
      request("DELETE", "/api/auth/user", {
        cookies: { "auth-ts.refresh": refreshToken }
      })
    )

    expect(response.status).toBe(403)
    expect(
      ((await response.json()) as { error: { code: string } }).error.code
    ).toBe("codeSent")
    expect(context.db.users()).toHaveLength(1)
    expect(required(context.sentCodes.at(-1), "code").purpose).toBe(
      "deleteUser"
    )
  })

  it("treats a zero-length freshness window as always requiring a code", async () => {
    // Regression: with `<=`, a session created in the same millisecond as the
    // request satisfied a zero window and deleted the account outright.
    vi.useFakeTimers()
    try {
      const context = await createTestServer({
        user: { deleteFreshWindow: "0s" }
      })
      const refreshToken = await signIn(context)

      const response = await context.authServer.handler(
        request("DELETE", "/api/auth/user", {
          cookies: { "auth-ts.refresh": refreshToken }
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
      const refreshToken = await signIn(context)

      vi.advanceTimersByTime(14 * 60_000)
      const fresh = await context.authServer.handler(
        request("DELETE", "/api/auth/user", {
          cookies: { "auth-ts.refresh": refreshToken }
        })
      )

      expect(fresh.status).toBe(204)
    } finally {
      vi.useRealTimers()
    }
  })

  it("completes deletion with the emailed code", async () => {
    const context = await createTestServer({
      user: { deleteFreshWindow: "0s" }
    })
    const refreshToken = await signIn(context)
    const cookies = { "auth-ts.refresh": refreshToken }

    await context.authServer.handler(
      request("DELETE", "/api/auth/user", { cookies })
    )
    const deletionCode = required(
      context.sentCodes.at(-1),
      "deletion code"
    ).code

    const response = await context.authServer.handler(
      request("DELETE", "/api/auth/user", {
        cookies,
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
    const refreshToken = await signIn(context)
    const cookies = { "auth-ts.refresh": refreshToken }

    // A fresh sign-in code for the same address must not authorize deletion.
    await context.authServer.handler(
      request("POST", "/api/auth/send-code", {
        body: { email: "ada@example.com" },
        cookies
      })
    )
    const signInCode = required(context.sentCodes.at(-1), "sign-in code")
    expect(signInCode.purpose).toBe("signIn")

    const response = await context.authServer.handler(
      request("DELETE", "/api/auth/user", {
        cookies,
        body: { code: signInCode.code }
      })
    )

    expect(response.status).toBe(401)
    expect(context.db.users()).toHaveLength(1)
  })

  it("rate limits repeated bare deletes rather than sending a storm of email", async () => {
    vi.useFakeTimers()
    try {
      const context = await createTestServer({
        user: { deleteFreshWindow: "0s" }
      })
      const refreshToken = await signIn(context)
      const cookies = { "auth-ts.refresh": refreshToken }
      const before = context.sentCodes.length

      for (let attempt = 0; attempt < 3; attempt++) {
        await context.authServer.handler(
          request("DELETE", "/api/auth/user", { cookies })
        )
        vi.advanceTimersByTime(61_000)
      }

      const limited = await context.authServer.handler(
        request("DELETE", "/api/auth/user", { cookies })
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
    const { refreshToken } = await signInAsGuest(context)

    const response = await context.authServer.handler(
      request("DELETE", "/api/auth/user", {
        cookies: { "auth-ts.refresh": refreshToken }
      })
    )

    expect(response.status).toBe(409)
    expect(
      ((await response.json()) as { error: { code: string } }).error.code
    ).toBe("guestCannotReceiveCode")
  })
})
