import { chmodSync } from "node:fs"
import { resolve } from "node:path"
import { defineConfig } from "vite"

// A Node command, not a library: one entry, a shebang, and every dependency
// left external — `jose` installs alongside it, and the `node:` built-ins are
// the runtime's own. Nothing is polyfilled for a browser because nothing here
// ever runs in one.
export default defineConfig({
  build: {
    lib: { entry: { cli: "src/cli.ts" }, formats: ["es"] },
    target: "node20",
    minify: false,
    rollupOptions: {
      external: [/^node:/, "jose"],
      output: { banner: "#!/usr/bin/env node" }
    }
  },
  plugins: [
    {
      // The shebang is only half of being runnable. npm sets the mode when it
      // installs a published tarball, but a workspace link points straight at
      // this file, so the build marks it executable itself.
      name: "executable-bin",
      writeBundle() {
        chmodSync(resolve(import.meta.dirname, "dist/cli.js"), 0o755)
      }
    }
  ]
})
