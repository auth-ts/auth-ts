import { describe, expect, it, vi } from "vitest"
import { createTestServer } from "../helpers/create-test-server"
import { mintToken, readSetCookies, request } from "../helpers/request"
import { required } from "../helpers/required"
import { insertUser, selectRow, selectRows } from "../helpers/rows"

type TestContext = Awaited<ReturnType<typeof createTestServer>>

/**
 * The access token this browser's cookies buy right now.
 *
 * Every authenticated call goes through one, so switching accounts means the
 * next call carries the token the new cookie minted — which is exactly the
 * sequence a client runs.
 */
const tokenFor = (context: TestContext, cookies: Record<string, string>) =>
  mintToken(context.authServer, cookies["auth-ts.refresh"] ?? "")

/** Signs an address in, carrying whatever cookies the browser already holds. */
async function signIn(
  context: TestContext,
  email: string,
  cookies: Record<string, string> = {}
) {
  await context.authServer.handler(
    request("POST", "/api/auth/sign-in/send-code", { body: { email }, cookies })
  )
  const response = await context.authServer.handler(
    request("POST", "/api/auth/sign-in/code", {
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
          request("GET", "/api/auth/accounts", {
            cookies: second.cookies,
            token: await tokenFor(context, second.cookies)
          })
        )
      ).status
    ).toBe(404)
    expect(
      (
        await context.authServer.handler(
          request("POST", "/api/auth/accounts/switch", {
            cookies: second.cookies,
            body: { userId: "x" },
            token: await tokenFor(context, second.cookies)
          })
        )
      ).status
    ).toBe(404)

    const whoami = await context.authServer.handler(
      request("GET", "/api/auth/user", {
        cookies: second.cookies,
        token: await tokenFor(context, second.cookies)
      })
    )
    expect(((await whoami.json()) as { email: string }).email).toBe(
      "grace@example.com"
    )
    expect(second.cookies["auth-ts.refresh.accounts"]).toBeUndefined()

    // Replaced means replaced: the browser overwrote its cookie, so the row the
    // first sign-in created is deleted rather than left live for a month where
    // nothing can reach it to revoke it.
    expect(context.db.sessions()).toHaveLength(1)
    expect(
      (
        await context.authServer.handler(
          request("GET", "/api/auth/user", {
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
      request("GET", "/api/auth/accounts", {
        cookies: second.cookies,
        token: await tokenFor(context, second.cookies)
      })
    )
    const body = (await response.json()) as Array<{ email: string }>

    // Active first, then the parked ones — the order is the answer, so no flag
    // has to say which is which.
    expect(body.map((account) => account.email)).toEqual([
      "grace@example.com",
      "ada@example.com"
    ])
  })

  it("holds five parked accounts alongside the active one", async () => {
    const context = await createTestServer(options)
    let cookies: Record<string, string> = {}

    for (const email of ["one", "two", "three", "four", "five", "six"]) {
      ;({ cookies } = await signIn(context, `${email}@example.com`, cookies))
    }

    const response = await context.authServer.handler(
      request("GET", "/api/auth/accounts", {
        cookies,
        token: await tokenFor(context, cookies)
      })
    )
    const body = (await response.json()) as Array<{ email: string }>

    expect(body).toHaveLength(6)
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
      request("GET", "/api/auth/accounts", {
        cookies,
        token: await tokenFor(context, cookies)
      })
    )
    const body = (await response.json()) as Array<{ email: string }>

    expect(body).toHaveLength(6)
    expect(body.map((account) => account.email)).not.toContain(
      "one@example.com"
    )

    // Evicted means signed out, not merely forgotten by this browser: the row is
    // deleted, so the token cannot be replayed from anywhere else either.
    expect(context.db.sessions()).toHaveLength(6)
    const evicted = required(
      context.db.users().find((user) => user.email === "one@example.com"),
      "evicted user"
    )
    expect(
      await selectRows(context.db, "sessions", { userId: evicted.id })
    ).toEqual([])
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
        body: { userId: adaId },
        token: await tokenFor(context, second.cookies)
      })
    )
    const body = (await response.json()) as {
      user: { email: string }
      token: string
    }

    expect(response.status).toBe(200)
    expect(body.user.email).toBe("ada@example.com")
    // The token comes back with the account it belongs to, so the switch and
    // the render after it cost one round trip between them.
    expect((await context.authServer.verifyToken(body.token))?.sub).toBe(adaId)

    const switched = readSetCookies(response)
    const whoami = await context.authServer.handler(
      request("GET", "/api/auth/user", {
        cookies: {
          "auth-ts.refresh": required(
            switched.get("auth-ts.refresh"),
            "refresh"
          ).value
        },
        token: body.token
      })
    )
    expect(((await whoami.json()) as { email: string }).email).toBe(
      "ada@example.com"
    )
  })

  it("404s a switch to an account this browser is not holding", async () => {
    const context = await createTestServer(options)
    const { cookies } = await signIn(context, "ada@example.com")
    const stranger = await insertUser(context.db, {
      email: "stranger@example.com"
    })

    const response = await context.authServer.handler(
      request("POST", "/api/auth/accounts/switch", {
        cookies,
        body: { userId: stranger.id },
        token: await tokenFor(context, cookies)
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
    await context.db.delete({ table: "sessions", where: { userId: ada.id } })

    const response = await context.authServer.handler(
      request("GET", "/api/auth/accounts", {
        cookies: second.cookies,
        token: await tokenFor(context, second.cookies)
      })
    )
    const body = (await response.json()) as Array<{ email: string }>

    expect(body.map((account) => account.email)).toEqual(["grace@example.com"])
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
    // Minted before the spy: buying the token is its own request, and its reads
    // are not the cost being measured here.
    const token = await tokenFor(context, cookies)
    // Every parked entry costs one read of `sessions`. The active session is not
    // among them — the token names it — and the users the listing reads
    // afterwards are not the cost being measured either.
    const select = vi.spyOn(context.db, "select")
    const sessionReads = () =>
      select.mock.calls.filter(([input]) => input.table === "sessions").length

    const forged = JSON.stringify(
      Array.from({ length: 1000 }, (_, index) => `forged-token-${index}`)
    )
    const response = await context.authServer.handler(
      request("GET", "/api/auth/accounts", {
        cookies: { ...cookies, "auth-ts.refresh.accounts": forged },
        token
      })
    )
    const body = (await response.json()) as Array<{ email: string }>

    expect(body.map((account) => account.email)).toEqual(["ada@example.com"])
    // Nothing at all: the forged entries are dropped whole.
    expect(sessionReads()).toBe(0)
    expect(
      readSetCookies(response).get("auth-ts.refresh.accounts")?.value
    ).toBe("[]")

    // Within the cap, duplicates collapse: three copies of the active token are
    // one parked entry, so one read rather than the three an un-deduped list
    // would cost.
    select.mockClear()
    const active = cookies["auth-ts.refresh"]
    await context.authServer.handler(
      request("GET", "/api/auth/accounts", {
        cookies: {
          ...cookies,
          "auth-ts.refresh.accounts": JSON.stringify([active, active, active])
        },
        token
      })
    )
    expect(sessionReads()).toBe(1)

    select.mockClear()
    await context.authServer.handler(
      request("GET", "/api/auth/accounts", {
        cookies: {
          ...cookies,
          "auth-ts.refresh.accounts": JSON.stringify([active, 42, null])
        },
        token
      })
    )
    // An entry that is not a string makes the whole cookie untrustworthy, so it
    // is dropped rather than filtered — no reads at all.
    expect(sessionReads()).toBe(0)
  })

  it("signs out every account in the browser by default, revoking each parked session", async () => {
    // The default everywhere it matters: "sign out" on a shared computer means
    // everyone. The parked rows are deleted, not merely dropped from the cookie
    // — a token the browser forgot but the database still honoured would be a
    // live session nobody can see to revoke.
    const context = await createTestServer(options)
    const first = await signIn(context, "ada@example.com")
    const second = await signIn(context, "grace@example.com", first.cookies)
    expect(context.db.sessions()).toHaveLength(2)

    const response = await context.authServer.handler(
      request("POST", "/api/auth/sign-out", {
        cookies: second.cookies,
        token: await tokenFor(context, second.cookies)
      })
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
          request("GET", "/api/auth/user", {
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

  it("signs out the named account and leaves the others parked", async () => {
    const context = await createTestServer(options)
    const first = await signIn(context, "ada@example.com")
    const second = await signIn(context, "grace@example.com", first.cookies)
    const grace = required(
      context.db.users().find((user) => user.email === "grace@example.com"),
      "grace"
    )

    const response = await context.authServer.handler(
      request("POST", "/api/auth/sign-out", {
        cookies: second.cookies,
        body: { userId: grace.id },
        token: await tokenFor(context, second.cookies)
      })
    )

    expect(response.status).toBe(204)
    expect(context.db.sessions()).toHaveLength(1)

    // Nothing is promoted: the browser holds no active account, and Ada's
    // session is still live and still parked, waiting to be switched to.
    const cookies = readSetCookies(response)
    expect(
      required(cookies.get("auth-ts.refresh"), "refresh").attributes
    ).toContain("Max-Age=0")
    expect(
      JSON.parse(
        required(cookies.get("auth-ts.refresh.accounts"), "accounts").value
      )
    ).toHaveLength(1)
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
      request("POST", "/api/auth/sign-out", {
        cookies: second.cookies,
        body: { scope: "global" },
        token: await tokenFor(context, second.cookies)
      })
    )

    expect(response.status).toBe(204)
    expect(context.db.sessions()).toHaveLength(0)
    expect(
      (
        await context.authServer.handler(
          request("GET", "/api/auth/user", {
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

  it("ends the named account everywhere and leaves the others parked", async () => {
    const context = await createTestServer(options)
    const graceElsewhere = await signIn(context, "grace@example.com")
    const first = await signIn(context, "ada@example.com")
    const second = await signIn(context, "grace@example.com", first.cookies)
    const graceId = required(
      context.db.users().find((user) => user.email === "grace@example.com"),
      "grace"
    ).id

    const response = await context.authServer.handler(
      request("POST", "/api/auth/sign-out", {
        cookies: second.cookies,
        body: { scope: "global", userId: graceId },
        token: await tokenFor(context, second.cookies)
      })
    )
    expect(response.status).toBe(204)
    // Grace is gone everywhere, Ada is untouched and still parked.
    expect(
      JSON.parse(
        required(
          readSetCookies(response).get("auth-ts.refresh.accounts"),
          "accounts"
        ).value
      )
    ).toHaveLength(1)
    const remaining = context.db.sessions()
    const ada = await selectRow(context.db, "users", {
      email: "ada@example.com"
    })
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.userId).toBe(ada?.id)
    expect(
      (
        await context.authServer.handler(
          request("GET", "/api/auth/user", {
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

  it("reaches every signed-in account's other devices, and none of this browser's", async () => {
    const context = await createTestServer(options)
    const adaElsewhere = await signIn(context, "ada@example.com")
    const first = await signIn(context, "ada@example.com")
    const second = await signIn(context, "grace@example.com", first.cookies)

    const response = await context.authServer.handler(
      request("POST", "/api/auth/sign-out", {
        cookies: second.cookies,
        body: { scope: "others" },
        token: await tokenFor(context, second.cookies)
      })
    )

    expect(response.status).toBe(204)
    expect(readSetCookies(response).size).toBe(0)
    // Naming no account means every account here, and `others` says how far
    // each one reaches: Ada's session elsewhere goes, both of this browser's
    // stay. Name a `userId` to reach only that account's other devices.
    expect(context.db.sessions()).toHaveLength(2)
    expect(
      (
        await context.authServer.handler(
          request("GET", "/api/auth/user", {
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
    expect(
      (
        await context.authServer.handler(
          request("GET", "/api/auth/user", {
            cookies: second.cookies,
            token: await tokenFor(context, second.cookies)
          })
        )
      ).status
    ).toBe(200)
  })

  it("signs out a parked account and leaves the active one alone", async () => {
    const context = await createTestServer(options)
    const first = await signIn(context, "ada@example.com")
    const second = await signIn(context, "grace@example.com", first.cookies)
    const adaId = required(
      context.db.users().find((user) => user.email === "ada@example.com"),
      "ada"
    ).id

    const response = await context.authServer.handler(
      request("POST", "/api/auth/sign-out", {
        cookies: second.cookies,
        body: { userId: adaId },
        token: await tokenFor(context, second.cookies)
      })
    )

    // Grace is still the active account, so the refresh cookie does not move —
    // only the parked list does.
    expect(response.status).toBe(204)
    expect(readSetCookies(response).has("auth-ts.refresh")).toBe(false)
    expect(context.db.sessions()).toHaveLength(1)
    expect(
      (
        await context.authServer.handler(
          request("GET", "/api/auth/user", {
            cookies: second.cookies,
            token: await tokenFor(context, second.cookies)
          })
        )
      ).status
    ).toBe(200)
  })

  it("refuses an account that is not signed in here", async () => {
    const context = await createTestServer(options)
    await signIn(context, "grace@example.com")
    const session = await signIn(context, "ada@example.com")
    const graceId = required(
      context.db.users().find((user) => user.email === "grace@example.com"),
      "grace"
    ).id
    const response = await context.authServer.handler(
      request("POST", "/api/auth/sign-out", {
        cookies: session.cookies,
        body: { userId: graceId },
        token: await tokenFor(context, session.cookies)
      })
    )

    expect(response.status).toBe(404)
    expect(context.db.sessions()).toHaveLength(2)
  })

  it("revokes the current session without disturbing the parked accounts", async () => {
    const context = await createTestServer(options)
    const first = await signIn(context, "ada@example.com")
    const second = await signIn(context, "grace@example.com", first.cookies)

    // Which session this browser is on comes from the session read, not from a
    // flag on the list.
    const read = await context.authServer.handler(
      request("GET", "/api/auth/session", {
        cookies: second.cookies,
        token: await tokenFor(context, second.cookies)
      })
    )
    const current = (await read.json()) as { id: string }
    const response = await context.authServer.handler(
      request("DELETE", `/api/auth/sessions/${current.id}`, {
        cookies: second.cookies,
        token: await tokenFor(context, second.cookies)
      })
    )
    expect(response.status).toBe(204)

    // The refresh cookie goes; nothing is promoted into the empty slot, and
    // Ada stays parked and signed in.
    const cookies = readSetCookies(response)
    expect(
      required(cookies.get("auth-ts.refresh"), "refresh").attributes
    ).toContain("Max-Age=0")
    expect(cookies.get("auth-ts.refresh.accounts")).toBeUndefined()
    expect(context.db.sessions()).toHaveLength(1)
  })

  it("clears both cookies when the last account signs out", async () => {
    const context = await createTestServer(options)
    const { cookies } = await signIn(context, "ada@example.com")

    const response = await context.authServer.handler(
      request("POST", "/api/auth/sign-out", {
        cookies,
        token: await tokenFor(context, cookies)
      })
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
      request("GET", "/api/auth/accounts", {
        cookies,
        token: await tokenFor(context, cookies)
      })
    )
    const body = (await response.json()) as Array<{ email: string | null }>

    expect(body).toHaveLength(1)
    expect(body[0]?.email).toBe("ada@example.com")
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
