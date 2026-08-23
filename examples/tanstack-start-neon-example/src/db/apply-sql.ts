import { readFileSync } from "node:fs"
import { Pool } from "@neondatabase/serverless"

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set in the .env file")
}

// The WebSocket pool takes each file whole: the HTTP driver runs one statement
// at a time, and the function bodies in triggers.sql rule out splitting them.
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
try {
  for (const file of ["privileges.sql", "triggers.sql"]) {
    await pool.query(readFileSync(new URL(file, import.meta.url), "utf8"))
    console.log(`applied ${file}`)
  }
} finally {
  await pool.end()
}
