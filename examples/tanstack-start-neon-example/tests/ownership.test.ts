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

/** Policies scope rows; privileges.test.ts scopes tables. */
const asUser = async <Result>(
  userId: string,
  run: () => Promise<Result>
): Promise<Result> => {
  await client.exec(
    `set role authenticated; select set_config('test.userId', '${userId}', false)`
  )
  try {
    return await run()
  } finally {
    await client.exec("reset role")
  }
}

let ada = ""
let grace = ""

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
  // Without grants no policy is consulted
  await client.exec(
    readFileSync(join(import.meta.dirname, "../src/db/privileges.sql"), "utf8")
  )

  const person = async (email: string) =>
    (
      await client.query<{ id: string }>(
        `insert into "users" ("email") values ($1) returning "id"`,
        [email]
      )
    ).rows[0]?.id ?? ""

  ada = await person("ada@example.test")
  grace = await person("grace@example.test")

  for (const [userId, tag] of [
    [ada, "ada"],
    [grace, "grace"]
  ]) {
    await client.query(
      `insert into "sessions" ("userId", "tokenHash", "expiresAt")
       values ($1, $2, now() + interval '30 days')`,
      [userId, `hash-${tag}`]
    )
    await client.query(
      `insert into "identities" ("userId", "provider", "providerUserId")
       values ($1, 'github', $2)`,
      [userId, `github-${tag}`]
    )
  }
})

describe("row ownership", () => {
  it.each(["users", "sessions", "identities"])(
    "shows a signed-in caller only their own %s",
    async (table) => {
      const rows = await asUser(ada, () =>
        client.query<{ userId?: string; id: string }>(
          `select * from "${table}"`
        )
      )

      expect(rows.rows).toHaveLength(1)
      expect(rows.rows[0]?.userId ?? rows.rows[0]?.id).toBe(ada)
    }
  )

  it("deletes nothing when the id belongs to somebody else", async () => {
    const theirs = await client.query<{ id: string }>(
      `select "id" from "sessions" where "userId" = $1`,
      [grace]
    )
    const id = theirs.rows[0]?.id ?? ""

    const deleted = await asUser(ada, () =>
      client.query(`delete from "sessions" where "id" = $1 returning "id"`, [
        id
      ])
    )

    expect(deleted.rows).toHaveLength(0)
    expect(
      (await client.query(`select "id" from "sessions" where "id" = $1`, [id]))
        .rows
    ).toHaveLength(1)
  })

  it("deletes the caller's own session, so revoking a device still works", async () => {
    const mine = await client.query<{ id: string }>(
      `select "id" from "sessions" where "userId" = $1`,
      [ada]
    )
    const id = mine.rows[0]?.id ?? ""

    const deleted = await asUser(ada, () =>
      client.query(`delete from "sessions" where "id" = $1 returning "id"`, [
        id
      ])
    )

    expect(deleted.rows).toHaveLength(1)
  })

  it("hides every row from a caller with no user id at all", async () => {
    const rows = await asUser("", () =>
      client.query(`select "id" from "users"`)
    )

    expect(rows.rows).toHaveLength(0)
  })
})
