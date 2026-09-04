import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    // Test against the server's source, not its last build, so a change there
    // is exercised here without a build in between — the same thing
    // tsconfig.base.json's `paths` do for the typechecker.
    alias: {
      "@auth-ts/core/testing": resolve(
        import.meta.dirname,
        "../core/src/testing.ts"
      ),
      "@auth-ts/core": resolve(import.meta.dirname, "../core/src/index.ts")
    }
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  }
})
