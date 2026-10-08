import { fetchWithToken, NeonPostgrestClient } from "@neondatabase/postgrest-js"
import { describe, expect, it, vi } from "vitest"
import type { Database } from "../src/types/database"

const dataApiUrl = "https://data.example.test/rest/v1"

describe("Neon PostgREST compatibility", () => {
  it("runs reads and mutations with current authorization", async () => {
    const rows = [{ id: "todo-1", title: "Test" }]
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const fetchSpy = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init })
        return Response.json(rows)
      }
    )
    let token = "first-test-token"
    const client = new NeonPostgrestClient<Database>({
      dataApiUrl,
      options: {
        global: { fetch: fetchWithToken(async () => token, fetchSpy) }
      }
    })

    const read = await client
      .from("todos")
      .select("id,title")
      .eq("completed", false)
    expect(read).toMatchObject({ data: rows, error: null, success: true })
    token = "second-test-token"
    const insert = await client
      .from("todos")
      .insert({ title: "Test" })
      .select("id,title")
    expect(insert).toMatchObject({ data: rows, error: null, success: true })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    const [first, second] = calls
    expect(first?.init?.method).toBe("GET")
    expect(
      new URL(first?.url ?? dataApiUrl).searchParams.get("completed")
    ).toBe("eq.false")
    expect(new Headers(first?.init?.headers).get("authorization")).toBe(
      "Bearer first-test-token"
    )
    expect(second?.init?.method).toBe("POST")
    expect(JSON.parse(String(second?.init?.body))).toEqual({ title: "Test" })
    expect(new Headers(second?.init?.headers).get("authorization")).toBe(
      "Bearer second-test-token"
    )
    for (const call of calls) {
      expect(new URL(call.url).pathname).toBe("/rest/v1/todos")
      expect(new Headers(call.init?.headers).has("x-neon-client-info")).toBe(
        true
      )
    }
  })

  it("preserves provider errors in the current response shape", async () => {
    const failure = {
      code: "42501",
      details: null,
      hint: null,
      message: "denied"
    }
    const fetchSpy = vi.fn(async () => Response.json(failure, { status: 403 }))
    const client = new NeonPostgrestClient<Database>({
      dataApiUrl,
      options: {
        global: { fetch: fetchWithToken(async () => "test-token", fetchSpy) }
      }
    })

    const response = await client.from("todos").select("id")
    expect(response).toMatchObject({
      success: false,
      data: null,
      error: failure,
      status: 403
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("rejects signed-out requests before reaching the data service", async () => {
    const fetchSpy = vi.fn(async () => Response.json([]))
    const client = new NeonPostgrestClient<Database>({
      dataApiUrl,
      options: { global: { fetch: fetchWithToken(async () => null, fetchSpy) } }
    })

    vi.useFakeTimers()
    try {
      const rejected = expect(
        client.from("todos").select("id").throwOnError()
      ).rejects.toThrow(/Authentication required/)
      await vi.runAllTimersAsync()
      await rejected
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
