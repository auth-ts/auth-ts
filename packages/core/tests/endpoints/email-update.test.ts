import { describe, expect, it, vi } from "vitest"
import { createTestServer } from "../helpers/create-test-server"
import {
  readRefreshCookie,
  readSetCookies,
  refreshCookieFor,
  request
} from "../helpers/request"
import { required } from "../helpers/required"
import { insertUser, selectRows } from "../helpers/rows"

type Context = Awaited<ReturnType<typeof createTestServer>>
type Session = { refreshToken: string; token: string }

const OLD = "ada@example.com"
const NEW = "ada@lovelace.example"

async function signIn(context: Context, email = OLD): Promise<Session> {
  await context.auth.handler(
    request("POST", "/api/auth/sign-in/send-code", { body: { email } })
  )
  const response = await context.auth.handler(
    request("POST", "/api/auth/sign-in/code", {
      body: { email, code: required(context.sentCodes.at(-1), "code").code }
    })
  )
  const { token } = (await response.json()) as { token: string }

  return {
    refreshToken: required(readRefreshCookie(response), "refresh").value,
    token
  }
}

/** "Confirm it's you": send the identity code, then verify it. */
async function verifyIdentity(context: Context, session: Session) {
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

const sendCode = (
  context: Context,
  session: Session,
  body: Record<string, unknown> = { email: NEW }
) =>
  context.auth.handler(
    request("POST", "/api/auth/user/email-update/send-code", {
      cookies: refreshCookieFor(session.refreshToken),
      token: session.token,
      body
    })
  )

const verify = (
  context: Context,
  session: Session,
  body: Record<string, unknown>
) =>
  context.auth.handler(
    request("POST", "/api/auth/user/email-update/verify", {
      cookies: refreshCookieFor(session.refreshToken),
      token: session.token,
      body: { email: NEW, ...body }
    })
  )

const lastCode = (context: Context) =>
  required(context.sentCodes.at(-1), "code").code

const codeOf = async (response: Response) =>
  ((await response.json()) as { code: string }).code

describe("changing the email address", () => {
  it("sends a code to the new address, then re-keys the account and tells the old one", async () => {
    const context = await createTestServer()
    const session = await signIn(context)
    expect((await verifyIdentity(context, session)).status).toBe(204)

    const sent = await sendCode(context, session)
    expect(sent.status).toBe(200)
    expect(readSetCookies(sent).get("auth-ts.attempt.email")).toBeDefined()
    const code = required(context.sentCodes.at(-1), "code")
    expect(code.destination).toBe(NEW)
    expect(code.purpose).toBe("emailChange")
    expect(context.db.users()[0]?.email).toBe(OLD)

    const response = await verify(context, session, { code: code.code })
    expect(response.status).toBe(200)
    expect(((await response.json()) as { email: string }).email).toBe(NEW)
    expect(context.db.users()[0]?.email).toBe(NEW)
    expect(
      readSetCookies(response).get("auth-ts.attempt.email")?.attributes
    ).toContain("Max-Age=0")
    expect(context.sentEmailChanges[0]?.email).toBe(OLD)
    expect(context.sentEmailChanges[0]?.user.email).toBe(NEW)
    expect(context.db.sessions()).toHaveLength(1)
  })

  it("answers the challenge until identity is verified, on both steps", async () => {
    const context = await createTestServer()
    const session = await signIn(context)

    const sent = await sendCode(context, session)
    expect(sent.status).toBe(403)
    expect(await codeOf(sent)).toBe("verificationRequired")

    const verified = await verify(context, session, { code: "ABCDEF" })
    expect(verified.status).toBe(403)
    expect(
      context.sentCodes.filter((c) => c.purpose === "emailChange")
    ).toEqual([])
  })

  it("holds the new address to the book's rules", async () => {
    const context = await createTestServer()
    const session = await signIn(context)
    await verifyIdentity(context, session)

    const upper = await sendCode(context, session, { email: "Ada@Example.com" })
    expect(upper.status).toBe(400)
    expect(await codeOf(upper)).toBe("invalidEmailAddress")

    const missing = await sendCode(context, session, {})
    expect(missing.status).toBe(400)
    expect(await codeOf(missing)).toBe("invalidField")
  })

  it("refuses an address another account signs in with, before and after the code", async () => {
    const context = await createTestServer()
    const session = await signIn(context)
    await verifyIdentity(context, session)
    await insertUser(context.db, { email: "grace@example.com" })

    const taken = await sendCode(context, session, {
      email: "grace@example.com"
    })
    expect(taken.status).toBe(409)
    expect(await codeOf(taken)).toBe("emailTaken")

    // Claimed between the send and the verify: the re-check is what catches it.
    await sendCode(context, session)
    const code = lastCode(context)
    await insertUser(context.db, { email: NEW })
    const late = await verify(context, session, { code })
    expect(late.status).toBe(409)
    expect(await codeOf(late)).toBe("emailTaken")
    expect(context.db.users()[0]?.email).toBe(OLD)
  })

  it("limits guesses per new address, five then 429", async () => {
    const context = await createTestServer()
    const session = await signIn(context)
    await verifyIdentity(context, session)
    await sendCode(context, session)

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrong = await verify(context, session, { code: "WRONG1" })
      expect(wrong.status).toBe(401)
      expect(await codeOf(wrong)).toBe("invalidCode")
    }
    const limited = await verify(context, session, { code: "WRONG1" })
    expect(limited.status).toBe(429)
    expect(context.db.users()[0]?.email).toBe(OLD)
  })

  it("binds the code to the browser that asked for it", async () => {
    const context = await createTestServer()
    const session = await signIn(context)
    await verifyIdentity(context, session)
    await sendCode(context, session)

    const elsewhere = await verify(context, session, {
      code: lastCode(context),
      attempt: "somebody-elses-token"
    })
    expect(elsewhere.status).toBe(401)
    expect(await codeOf(elsewhere)).toBe("invalidCode")
  })

  it("never spends a sign-in code as an email change", async () => {
    const context = await createTestServer()
    const session = await signIn(context)
    await verifyIdentity(context, session)
    await context.auth.handler(
      request("POST", "/api/auth/sign-in/send-code", { body: { email: NEW } })
    )

    const crossed = await verify(context, session, { code: lastCode(context) })
    expect(crossed.status).toBe(401)
    expect(context.db.users()[0]?.email).toBe(OLD)
  })

  it("kills the codes and markers that were keyed on the old address and its sessions", async () => {
    const context = await createTestServer()
    const session = await signIn(context)
    await verifyIdentity(context, session)
    await context.auth.handler(
      request("POST", "/api/auth/sign-in/send-code", { body: { email: OLD } })
    )
    const signInCode = lastCode(context)
    await sendCode(context, session)

    expect(
      (await verify(context, session, { code: lastCode(context) })).status
    ).toBe(200)

    const stale = await context.auth.handler(
      request("POST", "/api/auth/sign-in/code", {
        body: { email: OLD, code: signInCode }
      })
    )
    expect(stale.status).toBe(401)
    expect(await selectRows(context.db, "verifications", {})).toEqual([])

    // The marker went with them: the next verified action asks again.
    const deletion = await context.auth.handler(
      request("DELETE", "/api/auth/user", {
        cookies: refreshCookieFor(session.refreshToken),
        token: session.token
      })
    )
    expect(deletion.status).toBe(403)
  })

  it("lets the code age out with the others", async () => {
    vi.useFakeTimers()
    try {
      const context = await createTestServer()
      const session = await signIn(context)
      await verifyIdentity(context, session)
      await sendCode(context, session)
      const code = lastCode(context)

      vi.advanceTimersByTime(59 * 60_000)
      const late = await verify(context, session, { code })
      expect(late.status).toBe(200)
    } finally {
      vi.useRealTimers()
    }
  })

  it("refuses a guest, who has no address to confirm from", async () => {
    const context = await createTestServer({ guest: true })
    const response = await context.auth.handler(
      request("POST", "/api/auth/sign-in/guest")
    )
    const { token } = (await response.json()) as { token: string }
    const session = {
      refreshToken: required(readRefreshCookie(response), "refresh").value,
      token
    }

    const refused = await sendCode(context, session)
    expect(refused.status).toBe(409)
    expect(await codeOf(refused)).toBe("guestCannotReceiveCode")
  })
})
