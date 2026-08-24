import { describe, expect, it, vi } from "vitest"
import { createTestServer } from "../helpers/create-test-server"
import { readSetCookies, request } from "../helpers/request"
import { required } from "../helpers/required"

const options = {
  guest: true,
  user: {
    additionalFields: {
      referralCode: "string",
      seats: "number",
      betaOptIn: "boolean"
    } as const
  }
}

type TestContext = Awaited<ReturnType<typeof createTestServer>>

async function verifyWith(
  context: TestContext,
  email: string,
  additionalFields?: Record<string, unknown>
) {
  await context.authServer.handler(
    request("POST", "/api/auth/send-code", { body: { email } })
  )

  return context.authServer.handler(
    request("POST", "/api/auth/sign-in/code", {
      body: {
        email,
        code: required(context.sentCodes.at(-1), "code").code,
        additionalFields
      }
    })
  )
}

describe("additionalFields on sign-up", () => {
  it("stores declared fields flat on the user when the account is created", async () => {
    const context = await createTestServer(options)

    const response = await verifyWith(context, "ada@example.com", {
      referralCode: "ADA10",
      seats: 3,
      betaOptIn: true
    })
    const body = (await response.json()) as { user: Record<string, unknown> }

    expect(body.user.referralCode).toBe("ADA10")
    expect(body.user.seats).toBe(3)
    expect(body.user.betaOptIn).toBe(true)
  })

  it("ignores them when the user already exists, which is the mass-assignment guard", async () => {
    const context = await createTestServer(options)
    await verifyWith(context, "ada@example.com", { referralCode: "ADA10" })

    const second = await verifyWith(context, "ada@example.com", {
      referralCode: "STOLEN"
    })
    const body = (await second.json()) as { user: Record<string, unknown> }

    expect(body.user.referralCode).toBe("ADA10")
  })

  it("rejects an undeclared key", async () => {
    const context = await createTestServer(options)
    const response = await verifyWith(context, "ada@example.com", {
      isAdmin: true
    })

    expect(response.status).toBe(400)
    expect(((await response.json()) as { code: string }).code).toBe(
      "invalidField"
    )
  })

  it("rejects the body before the code is consumed, so the corrected retry still works", async () => {
    const context = await createTestServer(options)

    const rejected = await verifyWith(context, "ada@example.com", {
      isAdmin: true
    })
    expect(rejected.status).toBe(400)

    // Same code, fixed body: the code must still be there to consume.
    const retried = await context.authServer.handler(
      request("POST", "/api/auth/sign-in/code", {
        body: {
          email: "ada@example.com",
          code: required(context.sentCodes.at(-1), "code").code,
          additionalFields: { referralCode: "ADA10" }
        }
      })
    )
    const body = (await retried.json()) as { user: Record<string, unknown> }

    expect(retried.status).toBe(200)
    expect(body.user.referralCode).toBe("ADA10")
  })

  it("rejects a declared key of the wrong primitive type", async () => {
    const context = await createTestServer(options)
    const response = await verifyWith(context, "ada@example.com", {
      seats: "three"
    })

    expect(response.status).toBe(400)
    expect(((await response.json()) as { code: string }).code).toBe(
      "invalidField"
    )
  })

  it("accepts them on guest sign-in too", async () => {
    const context = await createTestServer(options)

    const response = await context.authServer.handler(
      request("POST", "/api/auth/sign-in/guest", {
        body: { additionalFields: { referralCode: "GUEST1" } }
      })
    )
    const body = (await response.json()) as { user: Record<string, unknown> }

    expect(body.user.referralCode).toBe("GUEST1")
  })

  it("applies them when a guest is upgraded in place — that is the sign-up", async () => {
    const context = await createTestServer(options)
    const guestResponse = await context.authServer.handler(
      request("POST", "/api/auth/sign-in/guest")
    )
    const cookies = {
      "auth-ts.refresh": required(
        readSetCookies(guestResponse).get("auth-ts.refresh"),
        "refresh"
      ).value
    }
    const guestId = ((await guestResponse.json()) as { user: { id: string } })
      .user.id

    await context.authServer.handler(
      request("POST", "/api/auth/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    const response = await context.authServer.handler(
      request("POST", "/api/auth/sign-in/code", {
        cookies,
        body: {
          email: "ada@example.com",
          code: required(context.sentCodes.at(-1), "code").code,
          additionalFields: { referralCode: "ADA10", seats: 3 }
        }
      })
    )
    const body = (await response.json()) as { user: Record<string, unknown> }

    expect(body.user.id).toBe(guestId)
    expect(body.user.type).toBe("user")
    expect(body.user.referralCode).toBe("ADA10")
    expect(body.user.seats).toBe(3)
  })

  it("drops them when a guest merges into an existing account, which nothing created", async () => {
    const context = await createTestServer(options)
    await verifyWith(context, "ada@example.com", { referralCode: "ADA10" })

    const guestResponse = await context.authServer.handler(
      request("POST", "/api/auth/sign-in/guest")
    )
    const cookies = {
      "auth-ts.refresh": required(
        readSetCookies(guestResponse).get("auth-ts.refresh"),
        "refresh"
      ).value
    }

    await context.authServer.handler(
      request("POST", "/api/auth/send-code", {
        body: { email: "ada@example.com" }
      })
    )
    const response = await context.authServer.handler(
      request("POST", "/api/auth/sign-in/code", {
        cookies,
        body: {
          email: "ada@example.com",
          code: required(context.sentCodes.at(-1), "code").code,
          additionalFields: { referralCode: "STOLEN" }
        }
      })
    )
    const body = (await response.json()) as { user: Record<string, unknown> }

    expect(body.user.referralCode).toBe("ADA10")
  })
})

describe("additionalFields on update", () => {
  it("accepts declared fields flat, beside name and image", async () => {
    const context = await createTestServer(options)
    const signInResponse = await verifyWith(context, "ada@example.com")
    const { token } = (await signInResponse.json()) as { token: string }

    const response = await context.authServer.handler(
      request("POST", "/api/auth/user", {
        token,
        body: { name: "Ada", referralCode: "UPDATED", seats: 9 }
      })
    )
    const user = (await response.json()) as Record<string, unknown>

    expect(user.name).toBe("Ada")
    expect(user.referralCode).toBe("UPDATED")
    expect(user.seats).toBe(9)
  })

  it("answers 400 for a body that changes nothing, without touching the database", async () => {
    // An UPDATE with no SET columns is an error in most query builders — the
    // in-memory store throws "no values to set", as a real one would — so an
    // an empty update used to surface as a 500. It is the client's mistake, and it
    // never reaches the store now.
    const context = await createTestServer(options)
    const signInResponse = await verifyWith(context, "ada@example.com")
    const { token } = (await signInResponse.json()) as { token: string }
    const update = vi.spyOn(context.db, "update")
    const insert = vi.spyOn(context.db, "insert")

    for (const body of [{}, { name: undefined }, { seats: undefined }]) {
      const response = await context.authServer.handler(
        request("POST", "/api/auth/user", { token, body })
      )
      expect(response.status).toBe(400)
      expect(((await response.json()) as { code: string }).code).toBe(
        "invalidField"
      )
    }
    // The token authenticates, so nothing is written at all — not the session,
    // and certainly not the user.
    expect(
      update.mock.calls.filter(([input]) => input.table === "users")
    ).toHaveLength(0)
    expect(insert).not.toHaveBeenCalled()
  })

  it("still rejects identity fields and undeclared keys", async () => {
    const context = await createTestServer(options)
    const signInResponse = await verifyWith(context, "ada@example.com")
    const { token } = (await signInResponse.json()) as { token: string }

    for (const body of [
      { type: "admin" },
      { email: "new@example.com" },
      { somethingElse: 1 }
    ]) {
      const response = await context.authServer.handler(
        request("POST", "/api/auth/user", { token, body })
      )
      expect(response.status).toBe(400)
    }
  })
})
