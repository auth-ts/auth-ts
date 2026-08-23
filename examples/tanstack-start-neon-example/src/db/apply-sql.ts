import { readFileSync } from "node:fs"
import { Pool } from "@neondatabase/serverless"

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set in the .env file")
}

// Grants live on columns and triggers on tables, so a push that recreates
// either drops it without saying so. The WebSocket pool takes both files whole:
// the HTTP driver runs one statement at a time, and the function bodies in
// triggers.sql cannot be split on semicolons.
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
try {
  for (const file of ["privileges.sql", "triggers.sql"]) {
    await pool.query(readFileSync(new URL(file, import.meta.url), "utf8"))
    console.log(`applied ${file}`)
  }
} finally {
  await pool.end()
}
