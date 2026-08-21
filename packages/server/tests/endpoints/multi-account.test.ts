import { describe, expect, it } from "vitest"
import { createTestServer } from "../helpers/create-test-server.ts"
import { readSetCookies, request } from "../helpers/request.ts"
import { required } from "../helpers/required.ts"

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

  it("promotes the next account on local sign-out instead of leaving the browser empty", async () => {
    const context = await createTestServer(options)
    const first = await signIn(context, "ada@example.com")
    const second = await signIn(context, "grace@example.com", first.cookies)

    const response = await context.authServer.handler(
      request("POST", "/api/auth/logout", { cookies: second.cookies })
    )
    const body = (await response.json()) as {
      switchedTo: { email: string }
      accessToken: string
    }

    expect(response.status).toBe(200)
    expect(body.switchedTo.email).toBe("ada@example.com")

    const promoted = readSetCookies(response)
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
