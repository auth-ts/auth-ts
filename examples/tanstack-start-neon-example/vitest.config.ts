import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

const stub = (file: string) => resolve(import.meta.dirname, "tests", file)

// Not vite.config.ts: that one loads the Cloudflare and TanStack Start plugins
// to build an application, and these tests only need the database layer.
export default defineConfig({
  test: { environment: "node" },
  resolve: {
    alias: [
      // Postgres in-process instead of over Neon's HTTP driver. Drizzle emits
      // the same SQL for both, so this proves the schema and the four
      // functions; it does not exercise the driver.
      { find: /^\.\.\/db\/db$/, replacement: stub("postgres.ts") },
      { find: "cloudflare:workers", replacement: stub("cloudflare-workers.ts") }
    ]
  }
})
