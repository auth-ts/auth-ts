import { defaultExclude, defineConfig } from "vitest/config"

// Exclude replaces vitest's defaults rather than extending them, so dropping
// the spread would put dist back in scope.
const SERVER_ONLY = [...defaultExclude, "tests/client/**"]

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "server",
          environment: "node",
          include: ["tests/**/*.test.ts"],
          exclude: SERVER_ONLY,
          typecheck: {
            enabled: true,
            include: ["tests/**/*.test-d.ts"],
            exclude: SERVER_ONLY
          }
        }
      },
      {
        test: {
          name: "client",
          environment: "happy-dom",
          include: ["tests/client/**/*.test.ts"]
        }
      }
    ]
  }
})
