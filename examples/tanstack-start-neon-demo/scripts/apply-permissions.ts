import "dotenv/config"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { Pool } from "@neondatabase/serverless"

/**
 * Applies `src/db/permissions.sql`, the second half of `bun run db:push`.
 *
 * Drizzle has no API for grants or for forcing row-level security, so the two
 * statements it cannot express live in SQL. Both are idempotent, so running
 * this on every push is a no-op rather than something to remember.
 *
 * The pooled driver is deliberate: the HTTP driver rejects multi-statement
 * queries, and this file is several statements.
 */
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set in the .env file")
}

const path = resolve(import.meta.dirname, "../src/db/permissions.sql")
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

try {
  await pool.query(readFileSync(path, "utf8"))
} finally {
  await pool.end()
}

console.log("Applied src/db/permissions.sql")
