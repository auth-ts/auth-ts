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
      body: { code: required(context.sentCodes.at(-1), "code").code }
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

  it("refuses a JSON body that is not an object, with a 400 rather than a 500", async () => {
    const context = await createTestServer()

    for (const body of [null, [], "ada@example.com", 123]) {
      const response = await context.auth.handler(
        request("POST", "/api/auth/sign-in/send-code", { body })
      )

      expect(response.status, JSON.stringify(body)).toBe(400)
      expect((await errorBody(response)).code, JSON.stringify(body)).toBe(
        "invalidField"
      )
    }
    expect(context.sentCodes).toHaveLength(0)
  })

  it("refuses a body that is not valid JSON, rather than reading it as empty", async () => {
    const context = await createTestServer()
    const response = await context.auth.handler(
      new Request("https://app.example.com/api/auth/sign-out", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "same-origin"
        },
        body: '{"scope":'
      })
    )

    expect(response.status).toBe(400)
    expect((await errorBody(response)).code).toBe("invalidField")
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

describe("how large a request body may be", () => {
  const post = (init: RequestInit & { body: BodyInit }) =>
    new Request("https://app.example.com/api/auth/sign-in/send-code", {
      method: "POST",
      ...init,
      headers: {
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        ...init.headers
      }
    })
  const padded = (bytes: number) => {
    const head = '{"email":"ada@example.com","pad":"'
    return `${head}${"x".repeat(bytes - head.length - 2)}"}`
  }

  it("takes a body of exactly 16 KiB and refuses one byte more by its length", async () => {
    const context = await createTestServer()

    // Within the cap the body is parsed, and its unknown key is what refuses it.
    const atCap = await context.auth.handler(post({ body: padded(16 * 1024) }))
    expect((await errorBody(atCap)).code).toBe("invalidField")

    const over = await context.auth.handler(
      post({ body: padded(16 * 1024 + 1) })
    )
    expect(over.status).toBe(413)
    expect((await errorBody(over)).code).toBe("payloadTooLarge")
  })

  it("stops reading a chunked body the moment it passes the cap", async () => {
    const context = await createTestServer()
    const chunk = new TextEncoder().encode("x".repeat(1024))
    let pulled = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        if (pulled > 64) controller.close()
        else controller.enqueue(chunk)
      }
    })

    const response = await context.auth.handler(
      post({ body: stream, duplex: "half" } as RequestInit & { body: BodyInit })
    )

    expect(response.status).toBe(413)
    expect(pulled).toBeLessThan(64)
  })

  it("reads an empty body as no fields", async () => {
    const context = await createTestServer({ guest: true })
    const response = await context.auth.handler(
      new Request("https://app.example.com/api/auth/sign-in/guest", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" }
      })
    )

    expect(response.status).toBe(200)
  })
})
