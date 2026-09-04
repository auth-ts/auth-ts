import { execFileSync } from "node:child_process"
import { defineConfig } from "vite"

const declarations = () => ({
  name: "declarations",
  closeBundle() {
    execFileSync("bun", ["x", "tsc", "-p", "tsconfig.build.json"], {
      stdio: "inherit"
    })
    execFileSync("bun", ["../../tools/build/dts-extensions.ts", "dist"], {
      stdio: "inherit"
    })
  }
})

export default defineConfig({
  plugins: [declarations()],
  build: {
    lib: {
      entry: {
        index: "src/index.ts",
        client: "src/client.ts",
        testing: "src/testing.ts"
      },
      formats: ["es"]
    },
    target: "es2022",
    minify: false,
    rollupOptions: { external: ["jose"] }
  }
})
