import { PGlite } from "@electric-sql/pglite"
import {
  generateDrizzleJson,
  generateMigration
} from "drizzle-kit/api-postgres"
import { drizzle } from "drizzle-orm/pglite"
import {
  attempts,
  identities,
  identitySecrets,
  sessions,
  users,
  verifications
} from "../src/db/schema"

const client = new PGlite()
await client.exec(`
  create role authenticated;
  create schema auth;
  create function auth.user_id() returns text as $$ select null::text $$ language sql;
`)

// Auth tables only; todos defaults to auth.user_id()
const statements = await generateMigration(
  await generateDrizzleJson({}),
  await generateDrizzleJson({
    users,
    sessions,
    verifications,
    attempts,
    identities,
    identitySecrets
  })
)
for (const statement of statements) await client.exec(statement)

// drizzle(client) would start a second database
export const db = drizzle({ client })
