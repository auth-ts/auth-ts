import { createFileRoute } from "@tanstack/react-router"
import { createFromSource } from "fumadocs-core/search/server"
import { source } from "~/lib/source"

const server = createFromSource(source)

/**
 * Exports the search index as a single JSON document.
 *
 * `staticGET` returns the whole index rather than answering one query, because
 * the deployed site is static: this route is prerendered to a file at build
 * time and the browser searches it locally. See `vite.config.ts` for the
 * prerender entry that writes it.
 */
export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      GET: () => server.staticGET()
    }
  }
})
