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
const SECRETS = [["sessions", "tokenHash"]]

/** Tables with RLS on and no policy — the Data API role sees and writes nothing. */
const SERVER_ONLY = ["verificationCodes", "attempts"]

beforeAll(async () => {
  await client.exec(`
    create role authenticated login;
    create schema auth;
    create function auth.user_id() returns text as $$
      select nullif(current_setting('test.userId', true), '')
    $$ language sql;
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

  // Without a policy every row is denied, so a column grant is never reached.
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

  it.each(SERVER_ONLY)(
    "denies every row and write of %s under policy-less RLS",
    async (table) => {
      await client.exec(
        `insert into "${table}" ${
          table === "attempts"
            ? `("key", "expiresAt") values ('k', now() + interval '10 minutes')`
            : `("identifier", "codeHash", "action", "expiresAt")
               values ('a@example.test', 'x', 'signIn', now() + interval '10 minutes')`
        }`
      )

      await client.exec("set role authenticated")
      try {
        const visible = await client.query(
          `select count(*) as n from "${table}"`
        )
        expect(visible.rows).toEqual([{ n: 0 }])
        await expect(
          client.exec(`delete from "${table}"`)
        ).resolves.toMatchObject([{ affectedRows: 0 }])
      } finally {
        await client.exec("reset role")
      }
    }
  )
})

describe("triggers.sql", () => {
  it.each(["users", "todos"])(
    "stamps %s.updatedAt from the database, whoever wrote the row",
    async (table) => {
      const { id } = (
        await client.query<{ id: string }>(
          table === "users"
            ? `insert into "users" ("type") values ('user') returning "id"`
            : `insert into "todos" ("userId", "title")
               values ((select "id" from "users" limit 1), 'x') returning "id"`
        )
      ).rows[0] as { id: string }

      await client.exec(
        `update "${table}" set "updatedAt" = '2000-01-01' where "id" = '${id}'`
      )
      const [row] = (
        await client.query<{ updatedAt: Date }>(
          `select "updatedAt" from "${table}" where "id" = '${id}'`
        )
      ).rows

      expect(row?.updatedAt.getFullYear()).toBeGreaterThan(2000)
    }
  )
})
