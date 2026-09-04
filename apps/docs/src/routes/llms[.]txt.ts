import { createFileRoute } from "@tanstack/react-router"
import { llms } from "fumadocs-core/source"
import { source } from "~/lib/source"

/**
 * The table of contents an LLM reads first: every page, titled and linked.
 *
 * Prerendered to a file like the search index, because the deployed site is
 * static. See `vite.config.ts` for the entry that writes it.
 */
export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(llms(source).index(), {
          headers: { "content-type": "text/plain; charset=utf-8" }
        })
    }
  }
})
