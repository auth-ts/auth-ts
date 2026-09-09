import { PostgrestClient } from "@supabase/postgrest-js"
import { defineRelations } from "drizzle-orm"
import {
  boolean,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid
} from "drizzle-orm/pg-core"
import { describe, expect, expectTypeOf, it } from "vitest"
import { createDrizzlePostgrest } from "../src/db/drizzle-postgrest"

const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
})

const todos = pgTable("todos", {
  id: uuid("id").primaryKey(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
  title: text("title").notNull(),
  isDone: boolean("is_done").notNull().default(false),
  meta: jsonb("meta").$type<{ dueAt?: string }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
})

const comments = pgTable("comments", {
  id: uuid("id").primaryKey(),
  todoId: uuid("todo_id")
    .notNull()
    .references(() => todos.id),
  body: text("body").notNull(),
  postedAt: timestamp("posted_at", { withTimezone: true }).notNull()
})

const schema = { users, todos, comments }

const at = "2026-01-01T00:00:00.000Z"
const later = "2026-01-02T00:00:00.000Z"
const userId = "0199a5c0-0000-7000-8000-000000000001"
const todoId = "0199a5c0-0000-7000-8000-000000000002"

function stubbed(body: unknown) {
  const requests: { url: URL; method: string; body: unknown }[] = []
  const client = new PostgrestClient("http://data.test", {
    fetch: async (input, init) => {
      requests.push({
        url: new URL(String(input)),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined
      })
      return new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" }
      })
    }
  })
  const params = (index = 0) => requests[index]?.url.searchParams
  return { requests, params, postgrest: createDrizzlePostgrest(schema, client) }
}

describe("flat rows", () => {
  it("translates columns in select, filters and order, and revives dates", async () => {
    const { params, postgrest } = stubbed([
      { id: userId, display_name: "Ada", created_at: at }
    ])

    const { data } = await postgrest
      .from("users")
      .select("id, displayName, createdAt")
      .eq("displayName", "Ada")
      .gt("createdAt", new Date(at))
      .in("createdAt", [new Date(at), new Date(later)])
      .order("createdAt", { ascending: false })
      .throwOnError()

    expect(params()?.get("select")).toBe("id,display_name,created_at")
    expect(params()?.get("display_name")).toBe("eq.Ada")
    expect(params()?.get("created_at")).toBe(`gt.${at}`)
    expect(params()?.getAll("created_at")[1]).toBe(`in.(${at},${later})`)
    expect(params()?.get("order")).toBe("created_at.desc")
    expect(data).toEqual([
      { id: userId, displayName: "Ada", createdAt: new Date(at) }
    ])
  })

  it("keeps aliases, casts and JSON paths as the caller wrote them", async () => {
    const { params, postgrest } = stubbed([
      { name: "Ada", created_at: at, dueAt: "tomorrow", at: at }
    ])

    const { data } = await postgrest
      .from("todos")
      .select("name:title, createdAt::text, meta->>dueAt, at:createdAt")
      .eq("meta->>dueAt", "tomorrow")
      .throwOnError()

    expect(params()?.get("select")).toBe(
      "name:title,created_at::text,meta->>dueAt,at:created_at"
    )
    expect(params()?.get("meta->>dueAt")).toBe("eq.tomorrow")
    expect(data).toEqual([
      { name: "Ada", createdAt: at, dueAt: "tomorrow", at: new Date(at) }
    ])
  })

  it("handles single rows, null rows and non-JSON bodies", async () => {
    const one = stubbed({ id: userId, display_name: "Ada", created_at: at })
    const { data } = await one.postgrest.from("users").select().single()
    expect(data?.createdAt).toEqual(new Date(at))

    const none = stubbed(null)
    expect(
      (await none.postgrest.from("users").select().maybeSingle()).data
    ).toBeNull()
  })
})

describe("embedded resources", () => {
  it("translates and maps back through any depth, with hints and aliases", async () => {
    const { params, postgrest } = stubbed([
      {
        id: userId,
        created_at: at,
        tasks: [
          {
            title: "Ship",
            created_at: at,
            comments: [{ body: "Done", posted_at: later }]
          }
        ]
      }
    ])

    const { data } = await postgrest
      .from("users")
      .select(
        "id, createdAt, tasks:todos!inner(title, createdAt, comments(body, postedAt))"
      )
      .eq("todos.isDone", false)
      .order("createdAt", { referencedTable: "todos", ascending: false })
      .order("postedAt", { referencedTable: "todos.comments" })
      .limit(5, { referencedTable: "todos" })
      .throwOnError()

    expect(params()?.get("select")).toBe(
      "id,created_at,tasks:todos!inner(title,created_at,comments(body,posted_at))"
    )
    expect(params()?.get("todos.is_done")).toBe("eq.false")
    expect(params()?.get("todos.order")).toBe("created_at.desc")
    expect(params()?.get("todos.comments.order")).toBe("posted_at.asc")
    expect(params()?.get("todos.limit")).toBe("5")
    expect(data).toEqual([
      {
        id: userId,
        createdAt: new Date(at),
        tasks: [
          {
            title: "Ship",
            createdAt: new Date(at),
            comments: [{ body: "Done", postedAt: new Date(later) }]
          }
        ]
      }
    ])
  })

  it("resolves an embed named by its foreign key column, and translates column hints", async () => {
    const { params, postgrest } = stubbed([
      { id: todoId, owner_id: { display_name: "Ada", created_at: at } }
    ])

    const { data } = await postgrest
      .from("todos")
      .select("id, ownerId(displayName, createdAt), users!ownerId(id)")
      .throwOnError()

    expect(params()?.get("select")).toBe(
      "id,owner_id(display_name,created_at),users!owner_id(id)"
    )
    expect(data).toEqual([
      { id: todoId, ownerId: { displayName: "Ada", createdAt: new Date(at) } }
    ])
  })

  it("spreads an embed into the parent row", async () => {
    const { params, postgrest } = stubbed([
      { id: todoId, display_name: "Ada", created_at: at }
    ])

    const { data } = await postgrest
      .from("todos")
      .select("id, ...users(displayName, createdAt)")
      .throwOnError()

    expect(params()?.get("select")).toBe("id,...users(display_name,created_at)")
    expect(data).toEqual([
      { id: todoId, displayName: "Ada", createdAt: new Date(at) }
    ])
  })

  it("spreads a star embed using the target table's columns", async () => {
    const { postgrest } = stubbed([
      { id: todoId, display_name: "Ada", created_at: at }
    ])

    const { data } = await postgrest
      .from("todos")
      .select("id, ...users(*)")
      .throwOnError()

    expect(data).toEqual([
      { id: todoId, displayName: "Ada", createdAt: new Date(at) }
    ])
  })
})

describe("aggregates", () => {
  it("translates the column and revives min and max of date columns", async () => {
    const { params, postgrest } = stubbed([
      { count: 2, newest: at, max: later, sum: 3 }
    ])

    const { data } = await postgrest
      .from("todos")
      .select(
        "count(), newest:createdAt.min(), createdAt.max(), id.count()::text"
      )
      .throwOnError()

    expect(params()?.get("select")).toBe(
      "count(),newest:created_at.min(),created_at.max(),id.count()::text"
    )
    expect(data).toEqual([
      { count: 2, newest: new Date(at), max: new Date(later), sum: 3 }
    ])
  })
})

describe("logic and filter strings", () => {
  it("translates columns inside or(), and() and not.", async () => {
    const { params, postgrest } = stubbed([])

    await postgrest
      .from("todos")
      .select()
      .or(
        "isDone.eq.true,and(ownerId.eq.x,not.title.ilike.%a%),not.or(createdAt.gt.2026,meta->>dueAt.is.null)"
      )
      .or("postedAt.is.null", { referencedTable: "comments" })
      .not("createdAt", "lt", new Date(at))
      .filter("comments.postedAt", "gte", new Date(later))

    expect(params()?.get("or")).toBe(
      "(is_done.eq.true,and(owner_id.eq.x,not.title.ilike.%a%),not.or(created_at.gt.2026,meta->>dueAt.is.null))"
    )
    expect(params()?.get("comments.or")).toBe("(posted_at.is.null)")
    expect(params()?.get("created_at")).toBe(`not.lt.${at}`)
    expect(params()?.get("comments.posted_at")).toBe(`gte.${later}`)
  })
})

describe("writes", () => {
  it("translates bodies, match, and onConflict, and maps the returned row", async () => {
    const { requests, params, postgrest } = stubbed({
      id: todoId,
      owner_id: userId,
      title: "Ship",
      is_done: false,
      meta: { dueAt: "x" },
      created_at: at
    })

    const { data } = await postgrest
      .from("todos")
      .insert({
        id: todoId,
        ownerId: userId,
        title: "Ship",
        meta: { dueAt: "x" },
        createdAt: new Date(at)
      })
      .select()
      .single()
      .throwOnError()
    expect(requests[0]?.body).toEqual({
      id: todoId,
      owner_id: userId,
      title: "Ship",
      meta: { dueAt: "x" },
      created_at: at
    })
    expect(data).toEqual({
      id: todoId,
      ownerId: userId,
      title: "Ship",
      isDone: false,
      meta: { dueAt: "x" },
      createdAt: new Date(at)
    })

    await postgrest
      .from("todos")
      .update({ isDone: true })
      .match({ ownerId: userId, createdAt: new Date(at) })
    expect(requests[1]?.body).toEqual({ is_done: true })
    expect(params(1)?.get("owner_id")).toBe(`eq.${userId}`)
    expect(params(1)?.get("created_at")).toBe(`eq.${at}`)

    await postgrest.from("todos").upsert(
      [
        { id: todoId, ownerId: userId, title: "A", createdAt: new Date(at) },
        { id: userId, ownerId: userId, title: "B", createdAt: new Date(at) }
      ],
      { onConflict: "ownerId,title" }
    )
    expect(params(2)?.get("on_conflict")).toBe("owner_id,title")
    expect(params(2)?.get("columns")).toBe(
      '"id","owner_id","title","created_at"'
    )
  })
})

describe("outside the schema", () => {
  it("leaves unknown tables and unknown embeds alone", async () => {
    const { params, postgrest } = stubbed([
      { phone: "x", audit_log: [{ changed_at: at }] }
    ])

    await postgrest.from("other" as "todos").select("title, isDone")
    expect(params()?.get("select")).toBe("title,isDone")

    const { data } = await postgrest
      .from("todos")
      .select("title, audit_log(changed_at)")
      .throwOnError()
    expect(params(1)?.get("select")).toBe("title,audit_log(changed_at)")
    expect(data?.[0]).toEqual({ phone: "x", audit_log: [{ changed_at: at }] })
  })
})

describe("with defineRelations", () => {
  const people = pgTable("people", {
    id: uuid("id").primaryKey(),
    name: text("name")
  })
  const tasks = pgTable("tasks", {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => people.id),
    editorId: uuid("editor_id").references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull()
  })
  const notes = pgTable("notes", {
    id: uuid("id").primaryKey(),
    taskId: uuid("task_id").references(() => tasks.id),
    body: text("body")
  })
  const relations = defineRelations({ people, tasks, notes }, (r) => ({
    people: {
      authored: r.many.tasks({ from: r.people.id, to: r.tasks.ownerId })
    },
    tasks: {
      owner: r.one.people({
        from: r.tasks.ownerId,
        to: r.people.id,
        optional: false
      }),
      editor: r.one.people({ from: r.tasks.editorId, to: r.people.id }),
      notes: r.many.notes({ from: r.tasks.id, to: r.notes.taskId })
    },
    notes: {
      task: r.one.tasks({ from: r.notes.taskId, to: r.tasks.id })
    }
  }))

  function withRelations(body: unknown) {
    const requests: { url: URL }[] = []
    const client = new PostgrestClient("http://data.test", {
      fetch: async (input) => {
        requests.push({ url: new URL(String(input)) })
        return new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json" }
        })
      }
    })
    return {
      params: () => requests[0]?.url.searchParams,
      postgrest: createDrizzlePostgrest(relations, client)
    }
  }

  it("embeds by relation name, keeping the name in the response", async () => {
    const { params, postgrest } = withRelations([
      {
        id: todoId,
        created_at: at,
        owner: { name: "Ada" },
        editor: { name: "Bob" },
        notes: [{ body: "hi" }]
      }
    ])

    const { data } = await postgrest
      .from("tasks")
      .select("id, createdAt, owner(name), editor!inner(name), notes(body)")
      .eq("owner.name", "Ada")
      .order("body", { referencedTable: "notes" })
      .throwOnError()

    expect(params()?.get("select")).toBe(
      "id,created_at,owner:people!owner_id(name),editor:people!editor_id!inner(name),notes!task_id(body)"
    )
    expect(params()?.get("owner.name")).toBe("eq.Ada")
    expect(params()?.get("notes.order")).toBe("body.asc")
    expect(data).toEqual([
      {
        id: todoId,
        createdAt: new Date(at),
        owner: { name: "Ada" },
        editor: { name: "Bob" },
        notes: [{ body: "hi" }]
      }
    ])
    expectTypeOf(data).toEqualTypeOf<
      {
        id: string
        createdAt: Date
        owner: { name: string | null }
        editor: { name: string | null }
        notes: { body: string | null }[]
      }[]
    >()
  })

  it("resolves hints and many names from the other side, mapping both back", async () => {
    const { params, postgrest } = withRelations([
      {
        authored: [{ id: todoId, created_at: at }],
        tasks: [{ id: todoId, created_at: later }]
      }
    ])

    const { data } = await postgrest
      .from("people")
      .select("authored(id, createdAt), tasks!owner(id, createdAt)")
      .throwOnError()

    expect(params()?.get("select")).toBe(
      "authored:tasks!owner_id(id,created_at),tasks!owner_id(id,created_at)"
    )
    expect(data).toEqual([
      {
        authored: [{ id: todoId, createdAt: new Date(at) }],
        tasks: [{ id: todoId, createdAt: new Date(later) }]
      }
    ])
  })

  it("types an optional one as nullable when it is the only path", async () => {
    const { postgrest } = withRelations([
      { id: userId, task: null, tasks: null }
    ])

    const { data } = await postgrest
      .from("notes")
      .select("id, task(id, createdAt), tasks(id)")
      .throwOnError()

    const rows: {
      id: string
      task: { id: string; createdAt: Date } | null
      tasks: { id: string } | null
    }[] = data
    const back: typeof data = rows
    expect(back).toBe(data)
    expect(data).toEqual([{ id: userId, task: null, tasks: null }])
  })
})

describe("casing", () => {
  const people = pgTable("people", {
    id: uuid().primaryKey(),
    firstName: text(),
    joinedAt: timestamp({ withTimezone: true }).notNull()
  })

  it("applies drizzle's casing to columns declared without a name", async () => {
    const requests: { url: URL }[] = []
    const client = new PostgrestClient("http://data.test", {
      fetch: async (input) => {
        requests.push({ url: new URL(String(input)) })
        return new Response(
          JSON.stringify([{ first_name: "Ada", joined_at: at }]),
          { headers: { "content-type": "application/json" } }
        )
      }
    })
    const postgrest = createDrizzlePostgrest({ people }, client, {
      casing: "snake_case"
    })

    const { data } = await postgrest
      .from("people")
      .select("firstName, joinedAt")
      .order("joinedAt")
      .throwOnError()

    expect(requests[0]?.url.searchParams.get("select")).toBe(
      "first_name,joined_at"
    )
    expect(requests[0]?.url.searchParams.get("order")).toBe("joined_at.asc")
    expect(data).toEqual([{ firstName: "Ada", joinedAt: new Date(at) }])
  })
})
