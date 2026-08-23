import { describe, expect, it } from "vitest"
import type { AuthTable } from "../../src/core/auth-db"
import { createTestServer } from "../helpers/create-test-server"
import { request } from "../helpers/request"
import { selectRows } from "../helpers/rows"

describe("generateId", () => {
  it("is unset by default, so the store names its own rows", async () => {
    const context = await createTestServer({ guest: true })

    await context.authServer.handler(request("POST", "/api/auth/sign-in/guest"))

    // Whatever the store put there, core read it back rather than assuming it.
    expect(context.db.users()[0]?.id).toEqual(expect.any(String))
  })

  it("names every row core inserts, when it is set", async () => {
    const seen: AuthTable[] = []
    let minted = 0
    const context = await createTestServer({
      guest: true,
      generateId: (table) => {
        seen.push(table)
        minted += 1
        return `${table}_${minted}`
      }
    })

    await context.authServer.handler(request("POST", "/api/auth/sign-in/guest"))

    expect(context.db.users()[0]?.id).toBe("users_1")
    expect(context.db.sessions()[0]?.id).toBe("sessions_2")
    expect(seen).toEqual(["users", "sessions"])
  })

  it("is awaited, so an id may come from somewhere that takes a moment", async () => {
    const context = await createTestServer({
      generateId: async (table) => `${table}_async`
    })

    await context.authServer.handler(
      request("POST", "/api/auth/send-code", {
        body: { email: "ada@example.com" }
      })
    )

    const [code] = await selectRows(context.db, "verifications")
    expect(code?.id).toBe("verifications_async")
  })
})
