import { readFileSync } from "node:fs"
import { join } from "node:path"
import { PGlite } from "@electric-sql/pglite"
import {
  generateDrizzleJson,
  generateMigration
} from "drizzle-kit/api-postgres"
import { beforeAll, describe, expect, it } from "vitest"
import * as schema from "../src/db/schema"

const client = new PGlite()

/** What the Data API role may do, per table, once both SQL files have run. */
async function as<T>(role: string, run: () => Promise<T>) {
  await client.exec(`set role ${role}`)
  try {
    return await run()
  } finally {
    await client.exec("reset role")
  }
}

const refused = (sql: string) => expect(client.exec(sql)).rejects.toThrow()

beforeAll(async () => {
  // Neon supplies the roles and auth.user_id(); the schema and the two SQL
  // files are ours, and are applied exactly as they would be against Neon.
  await client.exec(`
    create role authenticated login; create role anonymous login;
    create schema auth;
    create function auth.user_id() returns uuid as $$ select null::uuid $$ language sql;
  `)
  for (const statement of await generateMigration(
    await generateDrizzleJson({}),
    await generateDrizzleJson(schema as Record<string, unknown>)
  )) {
    await client.exec(statement)
  }
  const sql = (name: string) =>
    readFileSync(join(import.meta.dirname, "../src/db", name), "utf8")
  await client.exec(sql("privileges.sql"))
  await client.exec(sql("triggers.sql"))

  // The plan is for users to be readable through the Data API. Without a policy
  // every row is denied, and a column grant would never be reached — so the
  // checks below would pass while proving nothing.
  await client.exec(
    `create policy "own row" on "users" for all to authenticated using (true) with check (true)`
  )
})

describe("privileges.sql", () => {
  it("grants exactly these columns to the Data API role", async () => {
    const granted = await client.query<{
      table_name: string
      privilege_type: string
      column_name: string
    }>(`select table_name, privilege_type, column_name
        from information_schema.column_privileges
        where grantee = 'authenticated'
        order by table_name, privilege_type, column_name`)

    const summary: Record<string, string[]> = {}
    for (const row of granted.rows) {
      const key = `${row.table_name} ${row.privilege_type}`
      summary[key] = [...(summary[key] ?? []), row.column_name]
    }

    // Pinned, so a column added to a table or to a grant has to be looked at
    // rather than inherited. tokenHash, email, and phoneNumber are the ones
    // whose absence matters.
    expect(summary).toEqual({
      "sessions SELECT": [
        "createdAt",
        "expiresAt",
        "id",
        "ipAddress",
        "userAgent",
        "userId"
      ],
      "todos INSERT": ["completed", "title"],
      "todos SELECT": [
        "completed",
        "createdAt",
        "id",
        "title",
        "updatedAt",
        "userId"
      ],
      "todos UPDATE": ["completed", "title"],
      "users SELECT": ["createdAt", "id", "imageURL", "name", "type"],
      "users UPDATE": ["imageURL", "name"]
    })
  })

  it("grants delete on todos and nowhere else", async () => {
    // DELETE has no column form, so it is invisible to the query above.
    const granted = await client.query<{ table_name: string }>(
      `select table_name from information_schema.table_privileges
       where grantee = 'authenticated' and privilege_type = 'DELETE'`
    )

    expect(granted.rows.map((row) => row.table_name)).toEqual(["todos"])
  })

  it("hides what a client must never read", async () => {
    await as("authenticated", async () => {
      await refused(`select "tokenHash" from "sessions"`)
      await refused(`select * from "verificationCodes"`)
      await refused(`select * from "attempts"`)
      await refused(`select * from "connections"`)
      await refused(`select "email" from "users"`)
    })
  })
})

describe("triggers.sql", () => {
  it("stamps updatedAt from the database, overwriting the writer's value", async () => {
    const { id } = (
      await client.query<{ id: string }>(
        `insert into "users" ("type") values ('guest') returning "id"`
      )
    ).rows[0] as { id: string }

    await client.exec(
      `update "users" set "name" = 'Ada', "updatedAt" = '2000-01-01' where "id" = '${id}'`
    )
    const [row] = (
      await client.query<{ updatedAt: Date }>(
        `select "updatedAt" from "users" where "id" = '${id}'`
      )
    ).rows

    expect(row?.updatedAt.getFullYear()).toBeGreaterThan(2000)
  })
})
