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

/**
 * Tables with RLS on and no policy — the Data API role sees and writes nothing.
 *
 * This is where every secret lives, which is the point: protection is a table
 * nobody writes a policy for rather than a column somebody has to remember to
 * revoke. Forgetting a policy leaks nothing; forgetting a revoke leaked
 * ciphertext.
 */
const SERVER_ONLY = ["verifications", "attempts", "identitySecrets"]

/** One row per server-only table, so "denies every row" is tested against a row. */
const seedRow: Record<string, string> = {
  attempts: `insert into "attempts" ("key", "expiresAt")
             values ('k', now() + interval '10 minutes')`,
  verifications: `insert into "verifications"
                    ("identifier", "codeHash", "purpose", "expiresAt")
                  values ('a@example.test', 'x', 'signIn', now() + interval '10 minutes')`,
  identitySecrets: `insert into "users" ("id") values (uuidv7());
    insert into "identities" ("id", "userId", "provider", "providerUserId")
      select uuidv7(), "id", 'github', 'p1' from "users" limit 1;
    insert into "identitySecrets" ("identityId", "accessTokenEncrypted")
      select "id", 'v1.ciphertext' from "identities" limit 1`
}

/** Tables an application reads whole, because no column of them is a secret. */
const READABLE = ["users", "sessions", "identities"]

/**
 * The columns the Data API role may write, per table with a column grant.
 *
 * Exactly one entry, and it is the one that matters: Neon's default grants
 * UPDATE on every column, so without this a signed-in user sets their own
 * `type` to 'admin' or repoints `email` at another account.
 *
 * Checked as an exact complement rather than a blocklist: a column added to the
 * schema and forgotten in privileges.sql is granted by default, and that is the
 * failure this catches.
 */
const WRITABLE: Record<string, string[]> = {
  users: ["name", "image", "updatedAt"]
}

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

  // Without a policy every row is denied, so a grant is never reached.
  for (const table of READABLE) {
    await client.exec(
      `create policy "read" on "${table}" for select to authenticated using (true)`
    )
  }
})

describe("privileges.sql", () => {
  it.each(READABLE)("lets the Data API role read %s whole", async (table) => {
    // The change this file exists to record: no column of these is a secret,
    // so `select *` works and nothing has to be named.
    await client.exec("set role authenticated")
    try {
      await expect(
        client.exec(`select * from "${table}"`)
      ).resolves.toBeDefined()
    } finally {
      await client.exec("reset role")
    }
  })

  it.each(Object.keys(WRITABLE))(
    "lets %s be updated in exactly the columns it grants",
    async (table) => {
      const columns = async (query: string, parameters: unknown[]) =>
        (await client.query<{ column_name: string }>(query, parameters)).rows
          .map((row) => row.column_name)
          .sort()

      const granted = await columns(
        `select column_name from information_schema.column_privileges
         where grantee = 'authenticated' and privilege_type = 'UPDATE'
           and table_name = $1`,
        [table]
      )

      expect(granted).toEqual([...(WRITABLE[table] ?? [])].sort())
    }
  )

  it("refuses the self-promotion the users grant exists to stop", async () => {
    await client.exec("set role authenticated")
    try {
      await expect(
        client.exec(`update "users" set "type" = 'admin'`)
      ).rejects.toThrow()
      await expect(
        client.exec(`update "users" set "email" = 'someone@example.com'`)
      ).rejects.toThrow()
    } finally {
      await client.exec("reset role")
    }
  })

  it("enables row level security on every table", async () => {
    // ALTER DEFAULT PRIVILEGES grants CRUD to new tables.
    const unprotected = await client.query<{ relname: string }>(
      `select relname from pg_class
        where relnamespace = 'public'::regnamespace
          and relkind = 'r' and not relrowsecurity`
    )

    expect(unprotected.rows.map((row) => row.relname)).toEqual([])
  })

  it.each(SERVER_ONLY)(
    "denies every row and write of %s under policy-less RLS",
    async (table) => {
      await client.exec(seedRow[table] ?? "")

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
