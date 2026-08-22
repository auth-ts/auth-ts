import "dotenv/config"
import { defineConfig } from "drizzle-kit"

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set in the .env file")
}

export default defineConfig({
  schema: "./src/db/schema.ts", // Your schema file path
  out: "./drizzle", // Your migrations folder
  dialect: "postgresql",
  // drizzle-kit 1.0 no longer defaults this to public: without it, push sees
  // Neon's `auth` and `pgrst` schemas as undeclared and plans to drop them.
  schemaFilter: ["public"],
  dbCredentials: {
    url: process.env.DATABASE_URL
  }
})
