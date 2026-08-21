import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import react from "@vitejs/plugin-react"
import { fumadocsMdx } from "fumadocs-mdx/vite"
import { defineConfig } from "vite"
import tsConfigPaths from "vite-tsconfig-paths"
import * as sourceConfig from "./source.config"

export default defineConfig({
  // The type-table generator drives the TypeScript compiler, which ships as
  // CommonJS and references __filename. Bundling it into the ES module SSR graph
  // breaks at prerender time, so it is loaded by the runtime instead.
  ssr: { external: ["typescript", "fumadocs-typescript"] },
  plugins: [
    fumadocsMdx({ forcedConfig: sourceConfig }),
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    // Fully prerendered: the output is static files, which is what gets deployed
    // to Cloudflare Pages. Nothing here needs a server at request time.
    tanstackStart({
      prerender: { enabled: true },
      pages: [
        { path: "/" },
        {
          // The search index, written once at build time. It is JSON rather
          // than a page, so it needs an explicit filename and must not be
          // crawled for links.
          path: "/api/search",
          prerender: {
            enabled: true,
            outputPath: "/api/search.json",
            crawlLinks: false
          }
        }
      ]
    }),
    react()
  ]
})
