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
 * The row-ownership policies, against a real Postgres.
 *
 * `privileges.test.ts` proves which tables and columns the Data API role may
 * touch at all; this proves it only ever reaches its own rows. The two are
 * separate because they fail separately: a grant that is too wide hands over a
 * whole table, and a policy that is too wide hands over one column of everyone's.
 *
 * It matters more since revoking a device became a delete through the data
 * plane rather than an endpoint. The `where` that used to name both the session
 * id and the user id now lives here, as `using`.
 */
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
  // The grants live here, not in the schema: without them the role reaches no
  // table at all and a policy is never consulted.
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
    // The replacement for the endpoint check that used to answer 404 here: the
    // policy makes another user's id match no row rather than the wrong one.
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
