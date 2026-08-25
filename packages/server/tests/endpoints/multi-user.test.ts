import { describe, expect, it } from "vitest"
import { createTestServer } from "../helpers/create-test-server"
import { readSetCookies, request } from "../helpers/request"
import { required } from "../helpers/required"
import { selectRow, selectRows } from "../helpers/rows"

type TestContext = Awaited<ReturnType<typeof createTestServer>>
type Cookies = Record<string, string>

/** The user a refresh cookie belongs to, which its name carries. */
const usersInCookies = (cookies: Cookies) =>
  Object.keys(cookies)
    .filter((name) => name.startsWith("auth-ts.refresh."))
    .map((name) => name.slice("auth-ts.refresh.".length))

/**
 * The access token this browser's cookies buy right now.
 *
 * Every authenticated call goes through one, so switching users means the next
 * call carries the token the new hint minted — which is the sequence a client
 * runs.
 */
async function tokenFor(context: TestContext, cookies: Cookies) {
  const response = await context.authServer.handler(
    request("GET", "/api/auth/token", { cookies })
  )
  const body = (await response.json()) as { token?: string } | null

  return required(body?.token, "token")
}

/** Applies a response's `Set-Cookie` to a browser's jar, dropping cleared ones. */
function applyCookies(cookies: Cookies, response: { headers: Headers }) {
  const next = { ...cookies }
  for (const [name, cookie] of readSetCookies(response)) {
    if (cookie.attributes.includes("Max-Age=0")) delete next[name]
    else next[name] = cookie.value
  }

  return next
}

/** Signs an address in, carrying whatever cookies the browser already holds. */
async function signIn(
  context: TestContext,
  email: string,
  cookies: Cookies = {}
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
  const { user } = (await response.clone().json()) as { user: { id: string } }

  return { response, user, cookies: applyCookies(cookies, response) }
}

describe("multiUser disabled", () => {
  it("404s both user endpoints and replaces the session on a second sign-in", async () => {
    const context = await createTestServer()
    const first = await signIn(context, "ada@example.com")
    const second = await signIn(context, "grace@example.com", first.cookies)

    const listed = await context.authServer.handler(
      request("GET", "/api/auth/users", {
        cookies: second.cookies,
        token: await tokenFor(context, second.cookies)
      })
    )
    expect(listed.status).toBe(404)

    const switched = await context.authServer.handler(
      request("POST", "/api/auth/users/switch", {
        body: { userId: first.user.id },
        cookies: second.cookies,
        token: await tokenFor(context, second.cookies)
      })
    )
    expect(switched.status).toBe(404)

    // The displaced session is deleted rather than left live somewhere nobody
    // can revoke it, and its cookie goes with it.
    expect(
      await selectRows(context.db, "sessions", { userId: first.user.id })
    ).toHaveLength(0)
    expect(usersInCookies(second.cookies)).toEqual([second.user.id])
  })
})

describe("multiUser enabled", () => {
  const server = () => createTestServer({ multiUser: true })

  it("gives each user its own cookie and keeps both sessions live", async () => {
    const context = await server()
    const ada = await signIn(context, "ada@example.com")
    const grace = await signIn(context, "grace@example.com", ada.cookies)

    expect(usersInCookies(grace.cookies).sort()).toEqual(
      [ada.user.id, grace.user.id].sort()
    )
    expect(await selectRows(context.db, "sessions")).toHaveLength(2)
  })

  it("lists every signed in user", async () => {
    const context = await server()
    const ada = await signIn(context, "ada@example.com")
    const grace = await signIn(context, "grace@example.com", ada.cookies)

    const response = await context.authServer.handler(
      request("GET", "/api/auth/users", {
        cookies: grace.cookies,
        token: await tokenFor(context, grace.cookies)
      })
    )
    const users = (await response.json()) as { id: string }[]

    expect(users.map(({ id }) => id).sort()).toEqual(
      [ada.user.id, grace.user.id].sort()
    )
  })

  it("holds more than the five a single packed cookie used to allow", async () => {
    const context = await server()
    let cookies: Cookies = {}
    const ids: string[] = []
    for (let at = 0; at < 7; at++) {
      const signedIn = await signIn(context, `user${at}@example.com`, cookies)
      cookies = signedIn.cookies
      ids.push(signedIn.user.id)
    }

    expect(usersInCookies(cookies).sort()).toEqual([...ids].sort())
    expect(await selectRows(context.db, "sessions")).toHaveLength(7)
  })

  it("switches to another signed in user and mints a token for them", async () => {
    const context = await server()
    const ada = await signIn(context, "ada@example.com")
    const grace = await signIn(context, "grace@example.com", ada.cookies)

    const response = await context.authServer.handler(
      request("POST", "/api/auth/users/switch", {
        body: { userId: ada.user.id },
        cookies: grace.cookies,
        token: await tokenFor(context, grace.cookies)
      })
    )
    expect(response.status).toBe(200)

    const body = (await response.clone().json()) as { user: { id: string } }
    expect(body.user.id).toBe(ada.user.id)

    // The hint names the new active user, so the next bare `/token` resolves
    // to them without being told which cookie to spend.
    const after = applyCookies(grace.cookies, response)
    expect(after["auth-ts.hint"]).toBe(ada.user.id)

    const whoami = await context.authServer.handler(
      request("GET", "/api/auth/token", { cookies: after })
    )
    expect(((await whoami.json()) as { user: { id: string } }).user.id).toBe(
      ada.user.id
    )
  })

  it("404s a switch to a user this browser is not holding", async () => {
    const context = await server()
    const ada = await signIn(context, "ada@example.com")
    const stranger = await signIn(context, "grace@example.com")

    const response = await context.authServer.handler(
      request("POST", "/api/auth/users/switch", {
        body: { userId: stranger.user.id },
        cookies: ada.cookies,
        token: await tokenFor(context, ada.cookies)
      })
    )

    expect(response.status).toBe(404)
  })

  it("skips a user whose session was revoked elsewhere", async () => {
    const context = await server()
    const ada = await signIn(context, "ada@example.com")
    const grace = await signIn(context, "grace@example.com", ada.cookies)

    await context.db.delete({
      table: "sessions",
      where: { userId: ada.user.id }
    })

    const response = await context.authServer.handler(
      request("GET", "/api/auth/users", {
        cookies: grace.cookies,
        token: await tokenFor(context, grace.cookies)
      })
    )
    const users = (await response.json()) as { id: string }[]

    expect(users.map(({ id }) => id)).toEqual([grace.user.id])
  })

  it("signs every user out by default, clearing every cookie", async () => {
    const context = await server()
    const ada = await signIn(context, "ada@example.com")
    const grace = await signIn(context, "grace@example.com", ada.cookies)

    const response = await context.authServer.handler(
      request("POST", "/api/auth/sign-out", {
        cookies: grace.cookies,
        token: await tokenFor(context, grace.cookies)
      })
    )
    expect(response.status).toBe(204)

    expect(await selectRows(context.db, "sessions")).toHaveLength(0)
    expect(usersInCookies(applyCookies(grace.cookies, response))).toEqual([])
  })

  it("signs out the named user and leaves the others signed in", async () => {
    const context = await server()
    const ada = await signIn(context, "ada@example.com")
    const grace = await signIn(context, "grace@example.com", ada.cookies)

    const response = await context.authServer.handler(
      request("POST", "/api/auth/sign-out", {
        body: { userId: ada.user.id },
        cookies: grace.cookies,
        token: await tokenFor(context, grace.cookies)
      })
    )
    expect(response.status).toBe(204)

    const after = applyCookies(grace.cookies, response)
    expect(usersInCookies(after)).toEqual([grace.user.id])
    expect(
      await selectRows(context.db, "sessions", { userId: ada.user.id })
    ).toHaveLength(0)
    expect(
      await selectRows(context.db, "sessions", { userId: grace.user.id })
    ).toHaveLength(1)
  })

  it("hands the hint to whoever is left when the active user signs out", async () => {
    const context = await server()
    const ada = await signIn(context, "ada@example.com")
    const grace = await signIn(context, "grace@example.com", ada.cookies)

    const response = await context.authServer.handler(
      request("POST", "/api/auth/sign-out", {
        body: { userId: grace.user.id },
        cookies: grace.cookies,
        token: await tokenFor(context, grace.cookies)
      })
    )

    const after = applyCookies(grace.cookies, response)
    expect(after["auth-ts.hint"]).toBe(ada.user.id)

    const whoami = await context.authServer.handler(
      request("GET", "/api/auth/token", { cookies: after })
    )
    expect(((await whoami.json()) as { user: { id: string } }).user.id).toBe(
      ada.user.id
    )
  })

  it("reaches every signed in user's other devices under scope: global", async () => {
    const context = await server()
    const ada = await signIn(context, "ada@example.com")
    const grace = await signIn(context, "grace@example.com", ada.cookies)
    // Each of them signed in somewhere else too.
    await signIn(context, "ada@example.com")
    await signIn(context, "grace@example.com")
    expect(await selectRows(context.db, "sessions")).toHaveLength(4)

    await context.authServer.handler(
      request("POST", "/api/auth/sign-out", {
        body: { scope: "global" },
        cookies: grace.cookies,
        token: await tokenFor(context, grace.cookies)
      })
    )

    expect(await selectRows(context.db, "sessions")).toHaveLength(0)
  })

  it("leaves this browser alone under scope: others", async () => {
    const context = await server()
    const ada = await signIn(context, "ada@example.com")
    const grace = await signIn(context, "grace@example.com", ada.cookies)
    await signIn(context, "ada@example.com")
    await signIn(context, "grace@example.com")

    const response = await context.authServer.handler(
      request("POST", "/api/auth/sign-out", {
        body: { scope: "others" },
        cookies: grace.cookies,
        token: await tokenFor(context, grace.cookies)
      })
    )

    expect(response.headers.getSetCookie()).toEqual([])
    expect(await selectRows(context.db, "sessions")).toHaveLength(2)
    expect(await tokenFor(context, grace.cookies)).toBeTruthy()
  })

  it("404s a sign-out naming a user who is not signed in here", async () => {
    const context = await server()
    const ada = await signIn(context, "ada@example.com")
    const stranger = await signIn(context, "grace@example.com")

    const response = await context.authServer.handler(
      request("POST", "/api/auth/sign-out", {
        body: { userId: stranger.user.id },
        cookies: ada.cookies,
        token: await tokenFor(context, ada.cookies)
      })
    )

    expect(response.status).toBe(404)
  })

  it("signs one user out without disturbing the other", async () => {
    const context = await server()
    const ada = await signIn(context, "ada@example.com")
    const grace = await signIn(context, "grace@example.com", ada.cookies)

    const response = await context.authServer.handler(
      request("POST", "/api/auth/sign-out", {
        cookies: grace.cookies,
        token: await tokenFor(context, grace.cookies),
        body: { userId: grace.user.id }
      })
    )
    expect(response.status).toBe(204)

    const after = applyCookies(grace.cookies, response)
    expect(usersInCookies(after)).toEqual([ada.user.id])
    expect(
      await selectRows(context.db, "sessions", { userId: ada.user.id })
    ).toHaveLength(1)
  })
})

describe("guest conversion under multiUser", () => {
  it("replaces the guest session instead of leaving it beside the new one", async () => {
    const context = await createTestServer({ multiUser: true, guest: true })
    const guestResponse = await context.authServer.handler(
      request("POST", "/api/auth/sign-in/guest")
    )
    const guest = (await guestResponse.clone().json()) as {
      user: { id: string }
    }
    const guestCookies = applyCookies({}, guestResponse)

    const converted = await signIn(context, "ada@example.com", guestCookies)

    // One cookie, one session: the guest was upgraded in place, so it keeps its
    // id and gains the address — no second entry appears in the switcher.
    expect(converted.user.id).toBe(guest.user.id)
    expect(usersInCookies(converted.cookies)).toEqual([converted.user.id])
    expect(await selectRows(context.db, "sessions")).toHaveLength(1)
    expect(
      required(
        await selectRow(context.db, "users", { id: guest.user.id }),
        "converted user"
      ).type
    ).toBe("user")
  })
})
