import { defineConfig } from "drizzle-kit"

export default defineConfig({
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  // Manage only our own schema. Without this, push compares against everything
  // in the database and proposes dropping Neon's `auth` schema — the one that
  // provides `auth.user_id()` to the row-level security policies. It fails on a
  // permission error rather than succeeding, but it should never be attempted.
  schemaFilter: ["public"]
})
