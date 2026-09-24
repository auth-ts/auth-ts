import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

const stub = (file: string) => resolve(import.meta.dirname, "tests", file)

export default defineConfig({
  test: { environment: "node" },
  resolve: {
    alias: [
      // In-process Postgres; same SQL, driver untested
      { find: /^\.\.\/db\/db$/, replacement: stub("postgres.ts") },
      { find: "cloudflare:workers", replacement: stub("cloudflare-workers.ts") }
    ]
  }
})
