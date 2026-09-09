import { createAuthClient } from "@auth-ts/core/client"
import { fetchWithToken, NeonPostgrestClient } from "@neondatabase/postgrest-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Database } from "../src/types/database"

const dataApiUrl =
  process.env.VITE_NEON_DATA_API_URL ?? import.meta.env.VITE_NEON_DATA_API_URL
const live = Boolean(process.env.LIVE && dataApiUrl)

const memory = new Map<string, string>()
const authClient = createAuthClient({
  baseURL: process.env.LIVE_AUTH_URL ?? "http://localhost:3002",
  cookieStorage: {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => void memory.set(key, value),
    removeItem: (key) => void memory.delete(key)
  }
})

const postgrest = new NeonPostgrestClient<Database>({
  dataApiUrl: dataApiUrl ?? "",
  options: { global: { fetch: fetchWithToken(authClient.getToken) } }
})

/** Runs a guest session against the real Data API and cleans up after itself. */
describe.skipIf(!live)("Neon Data API", () => {
  let userId = ""
  const ids: string[] = []

  beforeAll(async () => {
    await authClient.signInAsGuest()
    const session = await authClient.refresh()
    if (!session) throw new Error("guest sign-in produced no session")
    userId = session.user.id
  })

  afterAll(async () => {
    if (ids.length) await postgrest.from("todos").delete().in("id", ids)
    if (userId) await authClient.deleteUser()
  })

  it("inserts with camelCase keys and gets rows back as stored", async () => {
    const { data } = await postgrest
      .from("todos")
      .insert([
        { title: "live a", userId, completed: false },
        { title: "live b", userId, completed: true }
      ])
      .select()
      .throwOnError()

    ids.push(...data.map((todo) => todo.id))
    expect(data).toHaveLength(2)
    expect(typeof data[0]?.createdAt).toBe("string")
    expect(data[0]?.userId).toBe(userId)
  })

  it("embeds the owner and spreads its columns", async () => {
    const { data } = await postgrest
      .from("todos")
      .select("id, title, createdAt, users(id, name), ...users(email)")
      .in("id", ids)
      .eq("users.id", userId)
      .order("title", { ascending: false })
      .throwOnError()

    expect(data).toHaveLength(2)
    expect(data[0]?.title).toBe("live b")
    expect(data[0]?.users).toEqual({ id: userId, name: null })
    expect(data[0]).toHaveProperty("email", null)
  })

  it("embeds from the other side with referencedTable ordering and limit", async () => {
    const { data } = await postgrest
      .from("users")
      .select("id, todos(id, title, updatedAt)")
      .eq("id", userId)
      .order("title", { referencedTable: "todos", ascending: false })
      .limit(1, { referencedTable: "todos" })
      .single()
      .throwOnError()

    expect(data.todos).toHaveLength(1)
    expect(data.todos[0]?.title).toBe("live b")
    expect(typeof data.todos[0]?.updatedAt).toBe("string")
  })

  it("filters with or(), match, and ISO timestamps", async () => {
    const { data } = await postgrest
      .from("todos")
      .select("id, completed")
      .in("id", ids)
      .or("completed.eq.true,title.ilike.%nomatch%")
      .gt("createdAt", new Date(Date.now() - 60_000).toISOString())
      .throwOnError()
    expect(data).toEqual([{ id: ids[1], completed: true }])

    const { data: matched } = await postgrest
      .from("todos")
      .update({ completed: true, updatedAt: new Date().toISOString() })
      .match({ userId, completed: false })
      .select("id, completed")
      .throwOnError()
    expect(matched).toEqual([{ id: ids[0], completed: true }])
  })

  it("aggregates when the server allows them", async () => {
    const { data, error } = await postgrest
      .from("todos")
      .select("count(), createdAt.max()")
      .in("id", ids)
      .single()

    if (error) {
      console.log("aggregates rejected by the server:", error.message)
      return
    }
    expect(data.count).toBe(2)
    expect(typeof data.max).toBe("string")
  })
})
