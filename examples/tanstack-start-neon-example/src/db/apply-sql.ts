import { readFileSync } from "node:fs"
import { Pool } from "@neondatabase/serverless"

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set in the .env file")
}

// HTTP driver runs one statement per query
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
try {
  for (const file of ["privileges.sql", "triggers.sql"]) {
    await pool.query(readFileSync(new URL(file, import.meta.url), "utf8"))
    console.log(`applied ${file}`)
  }
} finally {
  await pool.end()
}
