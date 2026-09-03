import { defineConfig } from "vite"

export default defineConfig({
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
