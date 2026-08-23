import { PGlite } from "@electric-sql/pglite"
import {
  generateDrizzleJson,
  generateMigration
} from "drizzle-kit/api-postgres"
import { drizzle } from "drizzle-orm/pglite"
import {
  attempts,
  connections,
  sessions,
  users,
  verificationCodes
} from "../src/db/schema"

const client = new PGlite()

// Postgres 18 in this process — real constraints, real cascades, no connection
// string. The DDL is generated from schema.ts rather than written out again, so
// the tables the checks run against cannot drift from the deployed ones. Only
// the auth tables: todos carries a Neon-specific default and a policy, and
// nothing here tests row-level security.
const statements = await generateMigration(
  await generateDrizzleJson({}),
  await generateDrizzleJson({
    users,
    sessions,
    verificationCodes,
    attempts,
    connections
  })
)
for (const statement of statements) await client.exec(statement)

// The client is passed explicitly: `drizzle(client)` treats it as connection
// config and quietly starts a second, empty database instead.
export const db = drizzle({ client })
