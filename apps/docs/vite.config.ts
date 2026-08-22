import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import react from "@vitejs/plugin-react"
import { fumadocsMdx } from "fumadocs-mdx/vite"
import { defineConfig } from "vite"

export default defineConfig({
  // The type-table generator drives the TypeScript compiler, which ships as
  // CommonJS and references __filename. Bundling it into the ES module SSR graph
  // breaks at prerender time, so it is loaded by the runtime instead.
  ssr: { external: ["typescript", "fumadocs-typescript"] },
  // Vite resolves the tsconfig `paths` itself; vite-tsconfig-paths was doing
  // this before the option existed and warns on every build now that it does.
  resolve: { tsconfigPaths: true },
  plugins: [
    // No forcedConfig: the plugin imports source.config.ts by path on its own,
    // which is how the upstream example wires it. Passing the module meant
    // importing "./source.config" here, and a config file that Vite's native
    // loader will one day run under Node's ESM rules cannot use an
    // extensionless relative import.
    fumadocsMdx(),
    tailwindcss(),
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
        },
        // The two llms.txt documents, written once at build time for the same
        // reason: text, not pages, and nothing in them to crawl.
        {
          path: "/llms.txt",
          prerender: {
            enabled: true,
            outputPath: "/llms.txt",
            crawlLinks: false
          }
        },
        {
          path: "/llms-full.txt",
          prerender: {
            enabled: true,
            outputPath: "/llms-full.txt",
            crawlLinks: false
          }
        },
        {
          // Cloudflare Pages serves 404.html for anything that matches no file,
          // which is the only way the not-found component reaches a cold visit
          // to a dead link.
          path: "/404",
          prerender: {
            enabled: true,
            outputPath: "/404.html",
            crawlLinks: false
          }
        }
      ]
    }),
    react()
  ]
})
