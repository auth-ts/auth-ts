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

/** Columns the browser must never read, whatever a policy allows. */
const SECRETS = [
  ["sessions", "tokenHash"],
  ["verificationCodes", "codeHash"]
]

beforeAll(async () => {
  await client.exec(`
    create role authenticated login;
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

  // Rows are denied outright without a policy, so a column grant would never be
  // reached and these checks would pass while proving nothing.
  for (const [table] of SECRETS) {
    await client.exec(
      `create policy "read" on "${table}" for select to authenticated using (true)`
    )
  }
})

describe("privileges.sql", () => {
  it.each(SECRETS)(
    "hides %s.%s from the Data API role",
    async (table, column) => {
      const granted = await client.query(
        `select 1 from information_schema.column_privileges
       where grantee = 'authenticated' and privilege_type = 'SELECT'
         and table_name = $1 and column_name = $2`,
        [table, column]
      )
      expect(granted.rows).toEqual([])

      await client.exec("set role authenticated")
      try {
        await expect(
          client.exec(`select "${column}" from "${table}"`)
        ).rejects.toThrow()
      } finally {
        await client.exec("reset role")
      }
    }
  )

  it.each(SECRETS)("still returns the other columns of %s", async (table) => {
    await client.exec("set role authenticated")
    try {
      await expect(
        client.exec(`select "id", "expiresAt" from "${table}"`)
      ).resolves.toBeDefined()
    } finally {
      await client.exec("reset role")
    }
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
