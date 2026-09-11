import { createFileRoute } from "@tanstack/react-router"
import { getLLMText, source } from "~/lib/source"

/**
 * Every page's processed Markdown in one document, for pasting into a model.
 *
 * Prerendered to a file like the search index, because the deployed site is
 * static. See `vite.config.ts` for the entry that writes it.
 */
export const Route = createFileRoute("/llms-full.txt")({
  server: {
    handlers: {
      GET: async () => {
        const pages = await Promise.all(source.getPages().map(getLLMText))

        return new Response(pages.join("\n\n"), {
          headers: { "content-type": "text/plain; charset=utf-8" }
        })
      }
    }
  }
})
