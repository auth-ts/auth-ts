import { describe, expect, it, vi } from "vitest"
import { createTestServer } from "../helpers/create-test-server"
import { readSetCookies, request } from "../helpers/request"
import { required } from "../helpers/required"

type TestContext = Awaited<ReturnType<typeof createTestServer>>

/** Signs an address in, carrying whatever cookies the browser already holds. */
async function signIn(
  context: TestContext,
  email: string,
  cookies: Record<string, string> = {}
) {
  await context.authServer.handler(
    request("POST", "/api/auth/send-code", { body: { email }, cookies })
  )
  const response = await context.authServer.handler(
    request("POST", "/api/auth/verify-code", {
      body: { email, code: required(context.sentCodes.at(-1), "code").code },
      cookies
    })
  )

  const setCookies = readSetCookies(response)
  const next = { ...cookies }
  for (const [name, cookie] of setCookies) next[name] = cookie.value

  return { response, cookies: next }
}

describe("multiAccount disabled", () => {
  it("404s the accounts endpoints and replaces the session on a second sign-in", async () => {
    const context = await createTestServer()
    const first = await signIn(context, "ada@example.com")
    const second = await signIn(context, "grace@example.com", first.cookies)

    expect(
      (
        await context.authServer.handler(
          request("GET", "/api/auth/accounts", { cookies: second.cookies })
        )
      ).status
    ).toBe(404)
    expect(
      (
        await context.authServer.handler(
          request("POST", "/api/auth/accounts/switch", {
            cookies: second.cookies,
            body: { userId: "x" }
          })
        )
      ).status
    ).toBe(404)

    const whoami = await context.authServer.handler(
      request("GET", "/api/auth/user", { cookies: second.cookies })
    )
    expect(
      ((await whoami.json()) as { user: { email: string } }).user.email
    ).toBe("grace@example.com")
    expect(second.cookies["auth-ts.refresh.accounts"]).toBeUndefined()

    // Replaced means replaced: the browser overwrote its cookie, so the row the
    // first sign-in created is deleted rather than left live for a month where
    // nothing can reach it to revoke it.
    expect(context.db.sessions()).toHaveLength(1)
    expect(
      (
        await context.authServer.handler(
          request("POST", "/api/auth/token", {
            cookies: {
              "auth-ts.refresh": required(
                first.cookies["auth-ts.refresh"],
                "refresh"
              )
            }
          })
        )
      ).status
    ).toBe(401)
  })

  it("leaves the existing session alone when a sign-in presents no cookie", async () => {
    // Presenting a session and then being issued a different one deletes the
    // presented row; a request that presents nothing deletes nothing.
    const context = await createTestServer()
    await signIn(context, "ada@example.com")
    await signIn(context, "grace@example.com")
    expect(context.db.sessions()).toHaveLength(2)
  })
})

describe("multiAccount enabled", () => {
  const options = { multiAccount: true }

  it("appends accounts, demoting the previous active one", async () => {
    const context = await createTestServer(options)
    const first = await signIn(context, "ada@example.com")
    const second = await signIn(context, "grace@example.com", first.cookies)

    const response = await context.authServer.handler(
      request("GET", "/api/auth/accounts", { cookies: second.cookies })
    )
    const body = (await response.json()) as {
      accounts: Array<{ user: { email: string }; current: boolean }>
    }

    expect(body.accounts).toHaveLength(2)
    expect(body.accounts.find((account) => account.current)?.user.email).toBe(
      "grace@example.com"
    )
    expect(
      body.accounts
        .filter((account) => !account.current)
        .map((account) => account.user.email)
    ).toEqual(["ada@example.com"])
  })

  it("holds five parked accounts alongside the active one", async () => {
    const context = await createTestServer(options)
    let cookies: Record<string, string> = {}

    for (const email of ["one", "two", "three", "four", "five", "six"]) {
      ;({ cookies } = await signIn(context, `${email}@example.com`, cookies))
    }

    const response = await context.authServer.handler(
      request("GET", "/api/auth/accounts", { cookies })
    )
    const body = (await response.json()) as {
      accounts: Array<{ user: { email: string } }>
    }

    expect(body.accounts).toHaveLength(6)
    expect(context.db.sessions()).toHaveLength(6)
  })

  it("evicts the oldest past the cap and signs that session out for real", async () => {
    const context = await createTestServer(options)
    let cookies: Record<string, string> = {}

    for (const email of [
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven"
    ]) {
      ;({ cookies } = await signIn(context, `${email}@example.com`, cookies))
    }

    const response = await context.authServer.handler(
      request("GET", "/api/auth/accounts", { cookies })
    )
    const body = (await response.json()) as {
      accounts: Array<{ user: { email: string } }>
    }

    expect(body.accounts).toHaveLength(6)
    expect(body.accounts.map((account) => account.user.email)).not.toContain(
      "one@example.com"
    )

    // Evicted means signed out, not merely forgotten by this browser: the row is
    // deleted, so the token cannot be replayed from anywhere else either.
    expect(context.db.sessions()).toHaveLength(6)
    const evicted = required(
      context.db.users().find((user) => user.email === "one@example.com"),
      "evicted user"
    )
    expect(await context.db.listSessions({ userId: evicted.id })).toEqual([])
  })

  it("switches to a parked account and mints a token for it", async () => {
    const context = await createTestServer(options)
    const first = await signIn(context, "ada@example.com")
    const adaId = required(
      context.db.users().find((user) => user.email === "ada@example.com"),
      "ada"
    ).id
    const second = await signIn(context, "grace@example.com", first.cookies)

    const response = await context.authServer.handler(
      request("POST", "/api/auth/accounts/switch", {
        cookies: second.cookies,
        body: { userId: adaId }
      })
    )
    const body = (await response.json()) as {
      accessToken: string
      user: { email: string }
    }

    expect(response.status).toBe(200)
    expect(body.user.email).toBe("ada@example.com")
    expect((await context.authServer.verifyToken(body.accessToken))?.sub).toBe(
      adaId
    )

    const switched = readSetCookies(response)
    const whoami = await context.authServer.handler(
      request("GET", "/api/auth/user", {
        cookies: {
          "auth-ts.refresh": required(
            switched.get("auth-ts.refresh"),
            "refresh"
          ).value
        }
      })
    )
    expect(
      ((await whoami.json()) as { user: { email: string } }).user.email
    ).toBe("ada@example.com")
  })

  it("404s a switch to an account this browser is not holding", async () => {
    const context = await createTestServer(options)
    const { cookies } = await signIn(context, "ada@example.com")
    const stranger = await context.db.upsertUser({
      email: "stranger@example.com"
    })

    const response = await context.authServer.handler(
      request("POST", "/api/auth/accounts/switch", {
        cookies,
        body: { userId: stranger.id }
      })
    )

    expect(response.status).toBe(404)
  })

  it("prunes accounts whose sessions were revoked elsewhere", async () => {
    const context = await createTestServer(options)
    const first = await signIn(context, "ada@example.com")
    const second = await signIn(context, "grace@example.com", first.cookies)

    const ada = required(
      context.db.users().find((user) => user.email === "ada@example.com"),
      "ada"
    )
    await context.db.deleteSessions({ userId: ada.id })

    const response = await context.authServer.handler(
      request("GET", "/api/auth/accounts", { cookies: second.cookies })
    )
    const body = (await response.json()) as {
      accounts: Array<{ user: { email: string } }>
    }

    expect(body.accounts.map((account) => account.user.email)).toEqual([
      "grace@example.com"
    ])
    expect(
      readSetCookies(response).get("auth-ts.refresh.accounts")?.value
    ).toBe("[]")
  })

  it("ignores a forged accounts cookie instead of running a query per entry", async () => {
    // The cookie is untrusted and each entry costs a hash and a lookup. One this
    // server wrote never exceeds the cap, so an oversized one is dropped whole
    // rather than turning a single request into a thousand sequential queries.
    const context = await createTestServer(options)
    const { cookies } = await signIn(context, "ada@example.com")
    const getSession = vi.spyOn(context.db, "getSession")

    const forged = JSON.stringify(
      Array.from({ length: 1000 }, (_, index) => `forged-token-${index}`)
    )
    const response = await context.authServer.handler(
      request("GET", "/api/auth/accounts", {
        cookies: { ...cookies, "auth-ts.refresh.accounts": forged }
      })
    )
    const body = (await response.json()) as {
      accounts: Array<{ user: { email: string } }>
    }

    expect(body.accounts.map((account) => account.user.email)).toEqual([
      "ada@example.com"
    ])
    // One lookup for the active session, none for the forged entries.
    expect(getSession).toHaveBeenCalledTimes(1)
    expect(
      readSetCookies(response).get("auth-ts.refresh.accounts")?.value
    ).toBe("[]")

    // Within the cap, duplicates collapse: three copies of the active token are
    // one parked entry, so the endpoint's two lookups (resolve, prune — the
    // listing reuses what the prune read) rather than the four the un-deduped
    // list would cost.
    getSession.mockClear()
    const active = cookies["auth-ts.refresh"]
    await context.authServer.handler(
      request("GET", "/api/auth/accounts", {
        cookies: {
          ...cookies,
          "auth-ts.refresh.accounts": JSON.stringify([active, active, active])
        }
      })
    )
    expect(getSession).toHaveBeenCalledTimes(2)

    getSession.mockClear()
    await context.authServer.handler(
      request("GET", "/api/auth/accounts", {
        cookies: {
          ...cookies,
          "auth-ts.refresh.accounts": JSON.stringify([active, 42, null])
        }
      })
    )
    expect(getSession).toHaveBeenCalledTimes(1)
  })

  it("signs out every account in the browser by default, revoking each parked session", async () => {
    // The Clerk and Better Auth default: "sign out" on a shared computer means
    // everyone. The parked rows are deleted, not merely dropped from the cookie
    // — a token the browser forgot but the database still honoured would be a
    // live session nobody can see to revoke.
    const context = await createTestServer(options)
    const first = await signIn(context, "ada@example.com")
    const second = await signIn(context, "grace@example.com", first.cookies)
    expect(context.db.sessions()).toHaveLength(2)

    const response = await context.authServer.handler(
      request("POST", "/api/auth/logout", { cookies: second.cookies })
    )
    const cleared = readSetCookies(response)

    expect(response.status).toBe(204)
    expect(
      required(cleared.get("auth-ts.refresh"), "refresh").attributes
    ).toContain("Max-Age=0")
    expect(
      required(cleared.get("auth-ts.refresh.accounts"), "accounts").attributes
    ).toContain("Max-Age=0")
    expect(context.db.sessions()).toHaveLength(0)
    expect(
      (
        await context.authServer.handler(
          request("POST", "/api/auth/token", {
            cookies: {
              "auth-ts.refresh": required(
                first.cookies["auth-ts.refresh"],
                "refresh"
              )
            }
          })
        )
      ).status
    ).toBe(401)
  })

  it("signs out only the active account with account: current, promoting the next", async () => {
    const context = await createTestServer(options)
    const first = await signIn(context, "ada@example.com")
    const second = await signIn(context, "grace@example.com", first.cookies)

    const response = await context.authServer.handler(
      request("POST", "/api/auth/logout", {
        cookies: second.cookies,
        body: { account: "current" }
      })
    )
    const body = (await response.json()) as {
      switchedTo: { email: string }
      accessToken: string
    }

    expect(response.status).toBe(200)
    expect(body.switchedTo.email).toBe("ada@example.com")
    expect(context.db.sessions()).toHaveLength(1)

    const promoted = readSetCookies(response)
    expect(
      required(promoted.get("auth-ts.refresh.accounts"), "accounts").value
    ).toBe("[]")
    const whoami = await context.authServer.handler(
      request("GET", "/api/auth/user", {
        cookies: {
          "auth-ts.refresh": required(
            promoted.get("auth-ts.refresh"),
            "refresh"
          ).value
        }
      })
    )
    expect(
      ((await whoami.json()) as { user: { email: string } }).user.email
    ).toBe("ada@example.com")
  })

  it("reaches every parked account's other devices under scope: global", async () => {
    // Ada is signed in on a second device too; a browser-wide global sign-out
    // ends that session as well as the parked one.
    const context = await createTestServer(options)
    const adaElsewhere = await signIn(context, "ada@example.com")
    const first = await signIn(context, "ada@example.com")
    const second = await signIn(context, "grace@example.com", first.cookies)
    expect(context.db.sessions()).toHaveLength(3)

    const response = await context.authServer.handler(
      request("POST", "/api/auth/logout", {
        cookies: second.cookies,
        body: { scope: "global" }
      })
    )

    expect(response.status).toBe(204)
    expect(context.db.sessions()).toHaveLength(0)
    expect(
      (
        await context.authServer.handler(
          request("POST", "/api/auth/token", {
            cookies: {
              "auth-ts.refresh": required(
                adaElsewhere.cookies["auth-ts.refresh"],
                "refresh"
              )
            }
          })
        )
      ).status
    ).toBe(401)
  })

  it("promotes the next account after a global sign-out of the current one", async () => {
    const context = await createTestServer(options)
    const graceElsewhere = await signIn(context, "grace@example.com")
    const first = await signIn(context, "ada@example.com")
    const second = await signIn(context, "grace@example.com", first.cookies)

    const response = await context.authServer.handler(
      request("POST", "/api/auth/logout", {
        cookies: second.cookies,
        body: { scope: "global", account: "current" }
      })
    )
    const body = (await response.json()) as { switchedTo: { email: string } }

    expect(response.status).toBe(200)
    expect(body.switchedTo.email).toBe("ada@example.com")
    // Grace is gone everywhere, Ada is untouched.
    const remaining = context.db.sessions()
    const ada = await context.db.getUser({ email: "ada@example.com" })
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.userId).toBe(ada?.id)
    expect(
      (
        await context.authServer.handler(
          request("POST", "/api/auth/token", {
            cookies: {
              "auth-ts.refresh": required(
                graceElsewhere.cookies["auth-ts.refresh"],
                "refresh"
              )
            }
          })
        )
      ).status
    ).toBe(401)
  })

  it("ignores account for scope: others, which reaches devices rather than accounts", async () => {
    const context = await createTestServer(options)
    const adaElsewhere = await signIn(context, "ada@example.com")
    const first = await signIn(context, "ada@example.com")
    const second = await signIn(context, "grace@example.com", first.cookies)

    const response = await context.authServer.handler(
      request("POST", "/api/auth/logout", {
        cookies: second.cookies,
        body: { scope: "others", account: "all" }
      })
    )

    expect(response.status).toBe(204)
    expect(readSetCookies(response).size).toBe(0)
    // Grace's and Ada's sessions in this browser survive; so does Ada elsewhere.
    expect(context.db.sessions()).toHaveLength(3)
    expect(
      (
        await context.authServer.handler(
          request("POST", "/api/auth/token", {
            cookies: {
              "auth-ts.refresh": required(
                adaElsewhere.cookies["auth-ts.refresh"],
                "refresh"
              )
            }
          })
        )
      ).status
    ).toBe(200)
  })

  it("clears both cookies when the last account signs out", async () => {
    const context = await createTestServer(options)
    const { cookies } = await signIn(context, "ada@example.com")

    const response = await context.authServer.handler(
      request("POST", "/api/auth/logout", { cookies })
    )
    const cleared = readSetCookies(response)

    expect(response.status).toBe(204)
    expect(
      required(cleared.get("auth-ts.refresh"), "refresh").attributes
    ).toContain("Max-Age=0")
    expect(
      required(cleared.get("auth-ts.refresh.accounts"), "accounts").attributes
    ).toContain("Max-Age=0")
  })
})

describe("guest conversion under multiAccount", () => {
  it("replaces the guest session instead of parking it", async () => {
    // A guest who signs in is not adding an account — they are finishing one.
    // Parking the anonymous session would leave a stranded guest in the
    // switcher, and its refresh token would stay valid.
    const context = await createTestServer({ multiAccount: true, guest: true })
    const guestResponse = await context.authServer.handler(
      request("POST", "/api/auth/sign-in/guest")
    )
    const guestCookies: Record<string, string> = {}
    for (const [name, cookie] of readSetCookies(guestResponse))
      guestCookies[name] = cookie.value
    const guestToken = required(guestCookies["auth-ts.refresh"], "guest token")

    const { cookies } = await signIn(context, "ada@example.com", guestCookies)

    const response = await context.authServer.handler(
      request("GET", "/api/auth/accounts", { cookies })
    )
    const body = (await response.json()) as {
      accounts: Array<{ user: { email: string | null }; current: boolean }>
    }

    expect(body.accounts).toHaveLength(1)
    expect(body.accounts[0]?.user.email).toBe("ada@example.com")
    expect(cookies["auth-ts.refresh.accounts"]).not.toContain(guestToken)
    expect(context.db.sessions()).toHaveLength(1)
    expect(
      (
        await context.authServer.handler(
          request("GET", "/api/auth/user", {
            cookies: { "auth-ts.refresh": guestToken }
          })
        )
      ).status
    ).toBe(401)
  })
})
