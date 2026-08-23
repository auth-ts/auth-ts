import { describe, expect, it } from "vitest"
import { createTestServer } from "../helpers/create-test-server"
import { readSetCookies, request } from "../helpers/request"
import { required } from "../helpers/required"

type TestContext = Awaited<ReturnType<typeof createTestServer>>

/** Signs an address in from a fresh browser and returns its refresh cookie. */
async function signIn(context: TestContext, email: string) {
  await context.authServer.handler(
    request("POST", "/api/auth/send-code", { body: { email } })
  )
  const response = await context.authServer.handler(
    request("POST", "/api/auth/verify-code", {
      body: { email, code: required(context.sentCodes.at(-1), "code").code }
    })
  )
  return {
    "auth-ts.refresh": required(
      readSetCookies(response).get("auth-ts.refresh"),
      "refresh"
    ).value
  }
}

async function listSessions(
  context: TestContext,
  cookies: Record<string, string>
) {
  const response = await context.authServer.handler(
    request("GET", "/api/auth/sessions", { cookies })
  )
  return ((await response.json()) as { sessions: Array<{ id: string }> })
    .sessions
}

/** The id of the session these cookies belong to, as a client would learn it. */
async function currentSessionId(
  context: TestContext,
  cookies: Record<string, string>
) {
  const response = await context.authServer.handler(
    request("GET", "/api/auth/session", { cookies })
  )

  return ((await response.json()) as { session: { id: string } }).session.id
}

describe("DELETE /sessions/:id", () => {
  it("revokes another device and says it was not the current session", async () => {
    const context = await createTestServer()
    const phone = await signIn(context, "ada@example.com")
    const laptop = await signIn(context, "ada@example.com")
    const sessions = await listSessions(context, laptop)
    const mine = await currentSessionId(context, laptop)
    // Which one is this device is the caller's comparison to make.
    const other = required(
      sessions.find((session) => session.id !== mine),
      "other session"
    )

    const response = await context.authServer.handler(
      request("DELETE", `/api/auth/sessions/${other.id}`, { cookies: laptop })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ current: false })
    expect(readSetCookies(response).size).toBe(0)
    expect(
      (
        await context.authServer.handler(
          request("GET", "/api/auth/user", { cookies: phone })
        )
      ).status
    ).toBe(401)
    expect(await listSessions(context, laptop)).toHaveLength(1)
  })

  it("revokes the current session as a local sign-out, clearing the cookie and saying so", async () => {
    // The client used to list every session first just to learn whether it
    // was revoking itself. The server knows, so it says.
    const context = await createTestServer()
    const cookies = await signIn(context, "ada@example.com")
    const current = { id: await currentSessionId(context, cookies) }

    const response = await context.authServer.handler(
      request(
        "DELETE",
        `/api/auth/sessions/${required(current, "current").id}`,
        {
          cookies
        }
      )
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ current: true })
    expect(
      required(readSetCookies(response).get("auth-ts.refresh"), "refresh")
        .attributes
    ).toContain("Max-Age=0")
    expect(
      (
        await context.authServer.handler(
          request("GET", "/api/auth/user", { cookies })
        )
      ).status
    ).toBe(401)
  })

  it("404s another user's session id, because ownership is in the query", async () => {
    const context = await createTestServer()
    const ada = await signIn(context, "ada@example.com")
    const grace = await signIn(context, "grace@example.com")
    const [adasSession] = await listSessions(context, ada)

    const response = await context.authServer.handler(
      request(
        "DELETE",
        `/api/auth/sessions/${required(adasSession, "ada's session").id}`,
        { cookies: grace }
      )
    )

    expect(response.status).toBe(404)
    expect(await listSessions(context, ada)).toHaveLength(1)
  })
})
