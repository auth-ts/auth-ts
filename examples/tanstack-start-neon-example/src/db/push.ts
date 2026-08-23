import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { Pool } from "@neondatabase/serverless"

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set in the .env file")
}

const push = spawnSync(
  "bun",
  ["x", "drizzle-kit", "push", ...process.argv.slice(2)],
  { stdio: "inherit" }
)
if (push.status !== 0) process.exit(push.status ?? 1)

// Grants live on columns and triggers on tables, so a push that recreates
// either drops it without saying so. Re-applied every time rather than
// remembered. The HTTP driver takes one statement at a time, and the function
// bodies in triggers.sql rule out splitting on semicolons.
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
try {
  for (const file of ["privileges.sql", "triggers.sql"]) {
    await pool.query(readFileSync(new URL(file, import.meta.url), "utf8"))
    console.log(`applied ${file}`)
  }
} finally {
  await pool.end()
}
