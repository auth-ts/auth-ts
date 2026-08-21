import { defineConfig } from "vite"

export default defineConfig({
  build: {
    lib: {
      entry: { index: "src/index.ts", testing: "src/lib/memory-db.ts" },
      formats: ["es"]
    },
    target: "es2022",
    minify: false,
    rollupOptions: { external: ["jose"] }
  }
})
