import { describe, expect, it, vi } from "vitest"
import { createTestServer } from "../helpers/create-test-server"
import {
  mintToken,
  readRefreshCookie,
  refreshCookieFor,
  refreshCookies,
  request,
  sessionIdOf
} from "../helpers/request"
import { required } from "../helpers/required"
import { insertUser, selectRow, selectRows } from "../helpers/rows"

const guestOptions = { guest: true }

async function signInGuest(
  context: Awaited<ReturnType<typeof createTestServer>>
) {
  const response = await context.auth.handler(
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
    const { auth } = await createTestServer()
    expect(
      (await auth.handler(request("POST", "/api/auth/sign-in/guest"))).status
    ).toBe(404)
  })

  it("creates an identifier-less user and issues a session", async () => {
    const context = await createTestServer(guestOptions)
    const { user, refreshToken, token } = await signInGuest(context)

    expect(user.type).toBe("guest")
    expect(context.db.users()).toHaveLength(1)
    expect(context.db.users()[0]?.email).toBeNull()
    expect(context.db.sessions()[0]?.amr).toEqual(["anonymous"])

    const whoami = await context.auth.handler(
      request("POST", "/api/auth/user", {
        cookies: refreshCookieFor(refreshToken),
        token,
        body: { name: "Guest" }
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
      rateLimit: { guestsPerIP: { capacity: 2, refill: "10m" } }
    })
    const headers = { "x-forwarded-for": "203.0.113.7" }

    await context.auth.handler(
      request("POST", "/api/auth/sign-in/guest", { headers })
    )
    await context.auth.handler(
      request("POST", "/api/auth/sign-in/guest", { headers })
    )
    const third = await context.auth.handler(
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

    const refused = await context.auth.handler(
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
      where: { userId: { eq: user.id } }
    })

    const response = await context.auth.handler(
      request("POST", "/api/auth/sign-in/guest", {
        cookies: refreshCookieFor(refreshToken)
      })
    )

    expect(response.status).toBe(200)
  })

  it("refuses a guest sign-in when any presented cookie is live, not only the hinted one", async () => {
    const context = await createTestServer({ guest: true, multiUser: true })
    const signedIn: Array<{ userId: string; refreshToken: string }> = []
    for (const email of ["ada@example.com", "grace@example.com"]) {
      await context.auth.handler(
        request("POST", "/api/auth/sign-in/send-code", { body: { email } })
      )
      const response = await context.auth.handler(
        request("POST", "/api/auth/sign-in/code", {
          body: {
            code: required(context.sentCodes.at(-1), "code").code
          }
        })
      )
      const { user } = (await response.json()) as { user: { id: string } }
      signedIn.push({
        userId: user.id,
        refreshToken: required(readRefreshCookie(response), "refresh").value
      })
    }
    const ada = required(signedIn[0], "ada")
    const grace = required(signedIn[1], "grace")
    await context.db.delete({
      table: "sessions",
      where: { userId: { eq: ada.userId } }
    })

    const refused = await context.auth.handler(
      request("POST", "/api/auth/sign-in/guest", {
        cookies: {
          ...refreshCookies({
            [ada.userId]: ada.refreshToken,
            [grace.userId]: grace.refreshToken
          }),
          "auth-ts.hint": ada.userId
        }
      })
    )

    expect(refused.status).toBe(409)
    expect(((await refused.json()) as { code: string }).code).toBe(
      "guestRequiresSignOut"
    )
    expect(context.db.users()).toHaveLength(2)
  })

  it("leaves a guest nothing to switch to — a 404, not a special case", async () => {
    // No refusal code exists for this on purpose: sign-in/guest refusing a
    // signed-in browser means a guest can never hold parked accounts, so the
    // switch's own target lookup already answers.
    const context = await createTestServer({ guest: true, multiUser: true })
    const { token, refreshToken } = await signInGuest(context)

    const refused = await context.auth.handler(
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

    await context.auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" },
        cookies
      })
    )
    const verifyResponse = await context.auth.handler(
      request("POST", "/api/auth/sign-in/code", {
        body: {
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
    expect(context.sentNotifications).toHaveLength(0)
    expect(body.user.type).toBe("user")
    expect(body.user.email).toBe("ada@example.com")
    expect(context.db.users()).toHaveLength(1)

    // The guest session is replaced, not left beside the new one. Asked of the
    // cookie, because the guest's access token names a user who still exists
    // and stays good until it expires — that is the revocation latency every
    // token buys, not a session surviving.
    expect(context.db.sessions()).toHaveLength(1)
    const refused = await context.auth.handler(
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

    await context.auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    const response = await context.auth.handler(
      request("POST", "/api/auth/sign-in/code", {
        token,
        body: {
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

    await context.auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    // The first guest's session is gone; the cookie says who this browser is
    // now, and the stale bearer must not send the sign-in somewhere else.
    await context.db.delete({
      table: "sessions",
      where: {
        id: {
          eq: required(
            context.db.sessions().find((row) => row.userId !== second.user.id),
            "first guest session"
          ).id
        }
      }
    })
    expect(refreshToken).not.toBe(second.refreshToken)

    const response = await context.auth.handler(
      request("POST", "/api/auth/sign-in/code", {
        token,
        cookies: refreshCookieFor(second.refreshToken),
        body: {
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

    await context.auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" },
        cookies
      })
    )
    const verifyResponse = await context.auth.handler(
      request("POST", "/api/auth/sign-in/code", {
        body: {
          code: required(context.sentCodes.at(-1), "code").code
        },
        cookies
      })
    )
    const body = (await verifyResponse.json()) as { user: { id: string } }

    expect(body.user.id).toBe(existing.id)
    // Somebody else's account was signed into, so its owner is told.
    expect(context.sentNotifications[0]?.email).toBe("ada@example.com")

    const guestRow = await selectRow(context.db, "users", {
      id: { eq: guest.id }
    })
    expect(guestRow?.primaryUserId).toBe(existing.id)
    expect(guestRow?.type).toBe("guest")

    // The anonymous session does not outlive the merge: its refresh token is
    // dead, so nothing can keep acting as the guest from this browser.
    expect(context.db.sessions()).toHaveLength(1)
    expect(context.db.sessions()[0]?.userId).toBe(existing.id)
    const refused = await context.auth.handler(
      request("GET", "/api/auth/token", { cookies })
    )

    expect(refused.status).toBe(200)
    expect(await refused.json()).toBeNull()
  })

  it("never converts a real user — signing in again just replaces the session", async () => {
    const context = await createTestServer()
    await context.auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    const first = await context.auth.handler(
      request("POST", "/api/auth/sign-in/code", {
        body: {
          code: required(context.sentCodes.at(-1), "code").code
        }
      })
    )
    const cookies = {
      ...refreshCookieFor(required(readRefreshCookie(first), "refresh").value)
    }

    await context.auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "grace@example.com" },
        cookies
      })
    )
    const second = await context.auth.handler(
      request("POST", "/api/auth/sign-in/code", {
        body: {
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

describe("identity verification, revoking a device, deleting the account", () => {
  const signIn = async (
    context: Awaited<ReturnType<typeof createTestServer>>
  ) => {
    await context.auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    const response = await context.auth.handler(
      request("POST", "/api/auth/sign-in/code", {
        body: {
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

  type Context = Awaited<ReturnType<typeof createTestServer>>
  type Session = { refreshToken: string; token: string }

  /** "Confirm it's you": send the identity code, then verify it. */
  const verify = async (context: Context, session: Session) => {
    const cookies = refreshCookieFor(session.refreshToken)
    await context.auth.handler(
      request("POST", "/api/auth/user/verify/send-code", {
        cookies,
        token: session.token
      })
    )
    return context.auth.handler(
      request("POST", "/api/auth/user/verify", {
        cookies,
        token: session.token,
        body: { code: required(context.sentCodes.at(-1), "identity code").code }
      })
    )
  }

  const deleteAccount = (context: Context, session: Session) =>
    context.auth.handler(
      request("DELETE", "/api/auth/user", {
        cookies: refreshCookieFor(session.refreshToken),
        token: session.token
      })
    )

  const revoke = (context: Context, session: Session, id: string) =>
    context.auth.handler(
      request("DELETE", `/api/auth/sessions/${id}`, {
        cookies: refreshCookieFor(session.refreshToken),
        token: session.token
      })
    )

  /** The session row a sign-in created, found by its token. */
  const rowOf = async (context: Context, session: Session) =>
    required(
      await selectRow(context.db, "sessions", {
        id: { eq: sessionIdOf(session.refreshToken) }
      }),
      "session row"
    )

  it("refuses to verify from a session revoked since its token was minted", async () => {
    const context = await createTestServer()
    const session = await signIn(context)
    const cookies = refreshCookieFor(session.refreshToken)
    await context.auth.handler(
      request("POST", "/api/auth/user/verify/send-code", {
        cookies,
        token: session.token
      })
    )
    const code = required(context.sentCodes.at(-1), "identity code").code
    await context.db.delete({
      table: "sessions",
      where: { id: { eq: sessionIdOf(session.refreshToken) } }
    })

    const response = await context.auth.handler(
      request("POST", "/api/auth/user/verify", {
        cookies,
        token: session.token,
        body: { code }
      })
    )

    expect(response.status).toBe(401)
    expect(((await response.json()) as { code: string }).code).toBe(
      "unauthenticated"
    )
  })

  it("deletes the account and clears the cookie once identity is verified", async () => {
    const context = await createTestServer()
    const session = await signIn(context)

    expect((await verify(context, session)).status).toBe(204)
    const response = await deleteAccount(context, session)

    expect(response.status).toBe(204)
    expect(context.db.users()).toHaveLength(0)
    expect(context.db.sessions()).toHaveLength(0)
    expect(
      required(readRefreshCookie(response), "cleared").attributes
    ).toContain("Max-Age=0")
  })

  it("answers the challenge outright, never a 2xx and never a side effect", async () => {
    const context = await createTestServer()
    const session = await signIn(context)
    const before = context.sentCodes.length

    const response = await deleteAccount(context, session)

    expect(response.status).toBe(403)
    expect(((await response.json()) as { code: string }).code).toBe(
      "verificationRequired"
    )
    expect(context.db.users()).toHaveLength(1)
    expect(context.sentCodes.length).toBe(before)
  })

  it("takes a revoked session's codes and marker with it, and no one else's", async () => {
    const context = await createTestServer()
    const first = await signIn(context)
    const second = await signIn(context)
    // The harness keeps the last attempt cookie; the revoker's must be it.
    await verify(context, second)
    await verify(context, first)
    const kept = (await rowOf(context, first)).id
    const gone = (await rowOf(context, second)).id

    expect((await revoke(context, first, gone)).status).toBe(204)
    expect(
      await selectRows(context.db, "verifications", {
        identifier: { eq: gone }
      })
    ).toEqual([])
    expect(
      await selectRows(context.db, "verifications", {
        identifier: { eq: kept }
      })
    ).toHaveLength(1)
  })

  it("takes a signed-out session's codes with it, and every session's under global", async () => {
    const context = await createTestServer()
    const first = await signIn(context)
    const second = await signIn(context)
    await verify(context, first)
    await verify(context, second)
    const markers = () => selectRows(context.db, "verifications", {})
    const signOut = (session: Session, scope: "local" | "global") =>
      context.auth.handler(
        request("POST", "/api/auth/sign-out", {
          cookies: refreshCookieFor(session.refreshToken),
          token: session.token,
          body: { scope }
        })
      )

    await signOut(first, "local")
    expect((await markers()).map((row) => row.identifier)).toEqual([
      (await rowOf(context, second)).id
    ])

    await signOut(second, "global")
    expect(await markers()).toEqual([])
  })

  it("takes the user's codes and identity markers with them", async () => {
    // Core deletes the children itself rather than requiring ON DELETE CASCADE,
    // and a code left behind would sign the address's next owner into nothing.
    const context = await createTestServer()
    const session = await signIn(context)
    await context.auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    await verify(context, session)
    const { id } = await rowOf(context, session)

    expect((await deleteAccount(context, session)).status).toBe(204)
    for (const identifier of ["ada@example.com", id]) {
      expect(
        await selectRows(context.db, "verifications", {
          identifier: { eq: identifier }
        })
      ).toEqual([])
    }
  })

  it("takes every session of theirs, on every device, and nobody else's", async () => {
    const context = await createTestServer()
    const session = await signIn(context)
    const ada = required(
      await selectRow(context.db, "users", {
        email: { eq: "ada@example.com" }
      }),
      "ada"
    )
    const insertSession = (userId: string, secretHash: string) =>
      context.db.insert({
        table: "sessions",
        values: {
          userId,
          secretHash,
          createdAt: new Date(),
          userAgent: null,
          ipAddress: null,
          updatedAt: new Date()
        }
      })
    await insertSession(ada.id, "ada-other-device")
    const grace = await insertUser(context.db, { email: "grace@example.com" })
    await insertSession(grace.id, "grace-laptop")

    await verify(context, session)
    expect((await deleteAccount(context, session)).status).toBe(204)

    expect(
      await selectRows(context.db, "sessions", { userId: { eq: ada.id } })
    ).toEqual([])
    expect(
      await selectRows(context.db, "sessions", { userId: { eq: grace.id } })
    ).toHaveLength(1)
  })

  it("refuses a token whose session has expired but is unswept", async () => {
    // Sessions are swept on insert only.
    vi.useFakeTimers()
    try {
      const context = await createTestServer({
        session: { ttl: "1s", sliding: false }
      })
      const { token } = await signIn(context)

      vi.advanceTimersByTime(2000)
      const response = await context.auth.handler(
        request("DELETE", "/api/auth/user", { token })
      )

      expect(response.status).toBe(401)
      expect(context.db.users()).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("sends nothing for a token whose session is already revoked", async () => {
    const context = await createTestServer()
    const { refreshToken, token } = await signIn(context)
    await context.auth.handler(
      request("POST", "/api/auth/sign-out", {
        cookies: refreshCookieFor(refreshToken),
        token
      })
    )
    const before = context.sentCodes.length

    const response = await context.auth.handler(
      request("POST", "/api/auth/user/verify/send-code", { token })
    )

    expect(response.status).toBe(401)
    expect(context.sentCodes.length).toBe(before)
  })

  it("binds the verification to the session that asked for it", async () => {
    // Two sessions of one user. A hijacked session elsewhere cannot borrow
    // the owner's verification, and cannot spend a code the owner asked for.
    const context = await createTestServer()
    const owner = await signIn(context)
    const other = await signIn(context)

    await context.auth.handler(
      request("POST", "/api/auth/user/verify/send-code", {
        cookies: refreshCookieFor(owner.refreshToken),
        token: owner.token
      })
    )
    const code = required(context.sentCodes.at(-1), "identity code").code
    const elsewhere = await context.auth.handler(
      request("POST", "/api/auth/user/verify", {
        cookies: refreshCookieFor(other.refreshToken),
        token: other.token,
        body: { code }
      })
    )
    expect(elsewhere.status).toBe(401)

    await context.auth.handler(
      request("POST", "/api/auth/user/verify", {
        cookies: refreshCookieFor(owner.refreshToken),
        token: owner.token,
        body: { code }
      })
    )
    expect((await deleteAccount(context, other)).status).toBe(403)
    expect((await deleteAccount(context, owner)).status).toBe(204)
  })

  it("binds the verification to the browser that holds the attempt", async () => {
    const context = await createTestServer()
    const session = await signIn(context)
    await verify(context, session)

    const anotherBrowser = await context.auth.handler(
      request("DELETE", "/api/auth/user", {
        cookies: {
          ...refreshCookieFor(session.refreshToken),
          "auth-ts.attempt.identity": "a-different-browser"
        },
        token: session.token
      })
    )

    expect(anotherBrowser.status).toBe(403)
    expect(context.db.users()).toHaveLength(1)
  })

  it("keeps the verification for an hour and no longer", async () => {
    vi.useFakeTimers()
    try {
      const context = await createTestServer({ session: { ttl: "10d" } })
      const session = await signIn(context)
      await verify(context, session)
      const refreshed = async () => ({
        ...session,
        token: await mintToken(context.auth, session.refreshToken)
      })

      vi.advanceTimersByTime(59 * 60_000)
      const other = required(
        await context.db.insert({
          table: "sessions",
          values: {
            userId: (await rowOf(context, session)).userId,
            secretHash: "another-device",
            createdAt: new Date(),
            updatedAt: new Date()
          }
        }),
        "session"
      )
      expect((await revoke(context, await refreshed(), other.id)).status).toBe(
        204
      )

      vi.advanceTimersByTime(2 * 60_000)
      expect((await deleteAccount(context, await refreshed())).status).toBe(403)
    } finally {
      vi.useRealTimers()
    }
  })

  it("refuses a wrong code and leaves no verification behind", async () => {
    const context = await createTestServer()
    const session = await signIn(context)
    await context.auth.handler(
      request("POST", "/api/auth/user/verify/send-code", {
        cookies: refreshCookieFor(session.refreshToken),
        token: session.token
      })
    )

    const wrong = await context.auth.handler(
      request("POST", "/api/auth/user/verify", {
        cookies: refreshCookieFor(session.refreshToken),
        token: session.token,
        body: { code: "??????" }
      })
    )

    expect(wrong.status).toBe(401)
    expect((await deleteAccount(context, session)).status).toBe(403)
  })

  it("refuses a sign-in code as an identity code", async () => {
    const context = await createTestServer()
    const session = await signIn(context)
    await context.auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    const signInCode = required(context.sentCodes.at(-1), "sign-in code")
    expect(signInCode.purpose).toBe("signIn")

    const response = await context.auth.handler(
      request("POST", "/api/auth/user/verify", {
        cookies: refreshCookieFor(session.refreshToken),
        token: session.token,
        body: { code: signInCode.code }
      })
    )

    expect(response.status).toBe(401)
    expect((await deleteAccount(context, session)).status).toBe(403)
  })

  it("revokes another of the user's sessions once verified", async () => {
    const context = await createTestServer()
    const owner = await signIn(context)
    const other = await signIn(context)
    const { id } = await rowOf(context, other)

    expect((await revoke(context, owner, id)).status).toBe(403)
    expect(context.db.sessions()).toHaveLength(2)

    await verify(context, owner)
    expect((await revoke(context, owner, id)).status).toBe(204)
    expect(context.db.sessions()).toHaveLength(1)
    expect(
      (
        await context.auth.handler(
          request("GET", "/api/auth/token", {
            cookies: refreshCookieFor(other.refreshToken)
          })
        )
      ).status
    ).toBe(200)
    expect(
      await (
        await context.auth.handler(
          request("GET", "/api/auth/token", {
            cookies: refreshCookieFor(other.refreshToken)
          })
        )
      ).json()
    ).toBeNull()
  })

  it("404s on a session that is not the caller's", async () => {
    const context = await createTestServer()
    const ada = await signIn(context)
    const grace = await insertUser(context.db, { email: "grace@example.com" })
    const hers = required(
      await context.db.insert({
        table: "sessions",
        values: {
          userId: grace.id,
          secretHash: "grace-laptop",
          createdAt: new Date(),
          updatedAt: new Date()
        }
      }),
      "session"
    )
    await verify(context, ada)

    expect((await revoke(context, ada, hers.id)).status).toBe(404)
    expect(context.db.sessions()).toHaveLength(2)
  })

  it("limits identity codes per user, apart from the address's sign-in sends", async () => {
    const context = await createTestServer({
      rateLimit: {
        sends: { capacity: 1, refill: "30m" },
        identitySends: { capacity: 2, refill: "1m" }
      }
    })
    const session = await signIn(context)
    // A stranger asking for sign-in codes to the address cannot block this.
    const stranger = await context.auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    expect(stranger.status).toBe(429)
    const before = context.sentCodes.length
    const send = () =>
      context.auth.handler(
        request("POST", "/api/auth/user/verify/send-code", {
          cookies: refreshCookieFor(session.refreshToken),
          token: session.token
        })
      )

    expect((await send()).status).toBe(200)
    expect((await send()).status).toBe(200)
    expect((await send()).status).toBe(429)
    expect(context.sentCodes.length - before).toBe(2)
  })

  it("refuses to delete a guest who has no way to verify", async () => {
    const context = await createTestServer({ guest: true })
    const { refreshToken, token } = await signInGuest(context)

    for (const [method, path] of [
      ["DELETE", "/api/auth/user"],
      ["POST", "/api/auth/user/verify/send-code"]
    ] as const) {
      const response = await context.auth.handler(
        request(method, path, {
          cookies: refreshCookieFor(refreshToken),
          token
        })
      )

      expect(response.status).toBe(409)
      expect(((await response.json()) as { code: string }).code).toBe(
        "guestCannotReceiveCode"
      )
    }
  })
})
