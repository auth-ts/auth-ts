import { createAuthClient } from "@auth-ts/core/client"
import { PostgrestClient } from "@supabase/postgrest-js"
import { defineRelations } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDrizzlePostgrest } from "../src/db/drizzle-postgrest"
import * as schema from "../src/db/schema"

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

const relations = defineRelations(schema, (r) => ({
  todos: {
    owner: r.one.users({
      from: r.todos.userId,
      to: r.users.id,
      optional: false
    })
  },
  users: {
    todos: r.many.todos({ from: r.users.id, to: r.todos.userId })
  }
}))

const postgrest = createDrizzlePostgrest(
  relations,
  new PostgrestClient(dataApiUrl ?? "", { fetch: authClient.fetchWithAuth })
)

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

  it("inserts with keys and gets rows back with Dates", async () => {
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
    expect(data[0]?.createdAt).toBeInstanceOf(Date)
    expect(data[0]?.userId).toBe(userId)
  })

  it("embeds by relation name, FK key, spread, and filters on the alias", async () => {
    const { data } = await postgrest
      .from("todos")
      .select(
        "id, title, createdAt, owner(id, name), userId(id), ...users(email)"
      )
      .in("id", ids)
      .eq("owner.id", userId)
      .order("title", { ascending: false })
      .throwOnError()

    expect(data).toHaveLength(2)
    expect(data[0]?.title).toBe("live b")
    expect(data[0]?.createdAt).toBeInstanceOf(Date)
    expect(data[0]?.owner).toEqual({ id: userId, name: null })
    expect(data[0]?.userId).toEqual({ id: userId })
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
    expect(data.todos[0]?.updatedAt).toBeInstanceOf(Date)
  })

  it("translates or(), match, and Date filters", async () => {
    const { data } = await postgrest
      .from("todos")
      .select("id, completed")
      .in("id", ids)
      .or("completed.eq.true,title.ilike.%nomatch%")
      .gt("createdAt", new Date(Date.now() - 60_000))
      .throwOnError()
    expect(data).toEqual([{ id: ids[1], completed: true }])

    const { data: matched } = await postgrest
      .from("todos")
      .update({ completed: true, updatedAt: new Date() })
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
    expect(data.max).toBeInstanceOf(Date)
  })
})
