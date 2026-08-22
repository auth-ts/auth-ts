import "dotenv/config"
import { defineConfig } from "drizzle-kit"

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set in the .env file")
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL },
  // Manage only our own schema. Without this, push compares against everything
  // in the database and proposes dropping Neon's `auth` schema — the one that
  // provides `auth.user_id()` to the row-level security policies. It fails on a
  // permission error rather than succeeding, but it should never be attempted.
  schemaFilter: ["public"]
})
