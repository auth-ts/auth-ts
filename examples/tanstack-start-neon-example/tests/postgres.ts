import { PGlite } from "@electric-sql/pglite"
import {
  generateDrizzleJson,
  generateMigration
} from "drizzle-kit/api-postgres"
import { drizzle } from "drizzle-orm/pglite"
import {
  attempts,
  identities,
  sessions,
  users,
  verificationCodes
} from "../src/db/schema"

const client = new PGlite()
await client.exec(`
  create role authenticated;
  create schema auth;
  create function auth.user_id() returns text as $$ select null::text $$ language sql;
`)

// DDL generated from schema.ts, so the tables cannot drift from the deployed
// ones. Auth tables only: todos carries a Neon-specific default.
const statements = await generateMigration(
  await generateDrizzleJson({}),
  await generateDrizzleJson({
    users,
    sessions,
    verificationCodes,
    attempts,
    identities
  })
)
for (const statement of statements) await client.exec(statement)

// Explicit: `drizzle(client)` reads it as config and starts a second, empty one.
export const db = drizzle({ client })
