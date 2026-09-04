import { describe, expect, it } from "vitest"
import { createTestServer } from "../helpers/create-test-server"
import { request } from "../helpers/request"
import { required } from "../helpers/required"
import { selectRow } from "../helpers/rows"

type TestContext = Awaited<ReturnType<typeof createTestServer>>

async function signIn(context: TestContext, email: string) {
  await context.auth.handler(
    request("POST", "/api/auth/sign-in/send-code", { body: { email } })
  )
  const response = await context.auth.handler(
    request("POST", "/api/auth/sign-in/code", {
      body: { email, code: required(context.sentCodes.at(-1), "code").code }
    })
  )

  return (await response.json()) as { user: { id: string }; token: string }
}

const errorBody = async (response: Response) =>
  (await response.json()) as { code: string; message: string }

describe("what a request body may name", () => {
  it("refuses a token in the body, which would outrank the header", async () => {
    // `CallerInput.token` is for callers with no request. Reaching it from the
    // wire would let a body name the caller, and beat the header while doing it.
    const context = await createTestServer()
    const alice = await signIn(context, "alice@example.com")
    const bob = await signIn(context, "bob@example.com")

    const response = await context.auth.handler(
      request("POST", "/api/auth/user", {
        token: bob.token,
        body: { name: "WHO AM I", token: alice.token }
      })
    )

    expect(response.status).toBe(400)
    expect((await errorBody(response)).code).toBe("invalidField")
    for (const user of [alice, bob]) {
      expect(
        (await selectRow(context.db, "users", { id: { eq: user.user.id } }))
          ?.name
      ).toBeNull()
    }
  })

  it("refuses a key no endpoint declared, rather than ignoring it", async () => {
    const context = await createTestServer()

    const response = await context.auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "ada@example.com", plan: "enterprise" }
      })
    )

    expect(response.status).toBe(400)
    expect((await errorBody(response)).code).toBe("invalidField")
    expect(context.sentCodes).toHaveLength(0)
  })

  it("refuses a field that exists on the user but cannot be posted", async () => {
    const context = await createTestServer()
    const ada = await signIn(context, "ada@example.com")

    const response = await context.auth.handler(
      request("POST", "/api/auth/user", {
        token: ada.token,
        body: { email: "someone-else@example.com" }
      })
    )

    expect(response.status).toBe(400)
    expect((await errorBody(response)).code).toBe("invalidField")
  })

  it("still takes a declared additional field on the flat body", async () => {
    const context = await createTestServer({
      user: { additionalFields: { plan: "string" } }
    })
    const ada = await signIn(context, "ada@example.com")

    const response = await context.auth.handler(
      request("POST", "/api/auth/user", {
        token: ada.token,
        body: { name: "Ada", plan: "pro" }
      })
    )

    expect(response.status).toBe(200)
    expect(
      await selectRow(context.db, "users", { id: { eq: ada.user.id } })
    ).toMatchObject({ name: "Ada", plan: "pro" })
  })
})
