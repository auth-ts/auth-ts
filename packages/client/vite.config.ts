import { defineConfig } from "vite"

export default defineConfig({
  build: {
    lib: { entry: { index: "src/index.ts" }, formats: ["es"] },
    target: "es2022",
    minify: false
  }
})
