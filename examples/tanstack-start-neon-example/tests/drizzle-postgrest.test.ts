import { PostgrestClient } from "@supabase/postgrest-js"
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { describe, expect, it } from "vitest"
import { createDrizzlePostgrest } from "../src/db/drizzle-postgrest"

const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey(),
  phoneNumber: text("phone_number"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
})

const row = {
  id: "0199a5c0-0000-7000-8000-000000000001",
  phone_number: "+15550100",
  created_at: "2026-01-01T00:00:00.000Z"
}

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
  return { requests, postgrest: createDrizzlePostgrest({ contacts }, client) }
}

describe("createDrizzlePostgrest", () => {
  it("reads: sends SQL names, returns keys, revives dates", async () => {
    const { requests, postgrest } = stubbed([row])

    const { data } = await postgrest
      .from("contacts")
      .select("id, phoneNumber")
      .eq("phoneNumber", "+15550100")
      .gt("createdAt", new Date("2025-12-31T00:00:00.000Z"))
      .order("createdAt", { ascending: false })
      .throwOnError()

    const params = requests[0]?.url.searchParams
    expect(params?.get("select")).toBe("id,phone_number")
    expect(params?.get("phone_number")).toBe("eq.+15550100")
    expect(params?.get("created_at")).toBe("gt.2025-12-31T00:00:00.000Z")
    expect(params?.get("order")).toBe("created_at.desc")

    expect(data).toEqual([
      {
        id: row.id,
        phoneNumber: row.phone_number,
        createdAt: new Date(row.created_at)
      }
    ])
  })

  it("writes: sends SQL names in the body and maps the returned row", async () => {
    const { requests, postgrest } = stubbed(row)

    const { data } = await postgrest
      .from("contacts")
      .insert({
        id: row.id,
        phoneNumber: row.phone_number,
        createdAt: new Date(row.created_at)
      })
      .select()
      .single()
      .throwOnError()

    expect(requests[0]?.method).toBe("POST")
    expect(requests[0]?.body).toEqual(row)
    expect(data.createdAt).toBeInstanceOf(Date)
    expect(data.phoneNumber).toBe(row.phone_number)
  })

  it("updates through match and upsert's onConflict", async () => {
    const { requests, postgrest } = stubbed([row])

    await postgrest
      .from("contacts")
      .update({ phoneNumber: "+15550199" })
      .match({ phoneNumber: row.phone_number })
    await postgrest.from("contacts").upsert(
      {
        id: row.id,
        phoneNumber: "+15550199",
        createdAt: new Date(row.created_at)
      },
      { onConflict: "phoneNumber" }
    )

    expect(requests[0]?.body).toEqual({ phone_number: "+15550199" })
    expect(requests[0]?.url.searchParams.get("phone_number")).toBe(
      `eq.${row.phone_number}`
    )
    expect(requests[1]?.url.searchParams.get("on_conflict")).toBe(
      "phone_number"
    )
  })

  it("leaves a table it does not know alone", async () => {
    const { requests, postgrest } = stubbed([])

    await postgrest.from("other" as "contacts").select("phoneNumber")

    expect(requests[0]?.url.searchParams.get("select")).toBe("phoneNumber")
  })
})
