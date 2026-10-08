import { createFileRoute, notFound } from "@tanstack/react-router"
import { getLLMText, source } from "~/lib/source"

/** One page as Markdown, for the copy and "open in" actions. */
export const Route = createFileRoute("/llms.mdx/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const [, ...slugs] = (params._splat ?? "")
          .replace(/\.md$/, "")
          .split("/")
        const page = source.getPage(slugs)
        if (!page) throw notFound()

        return new Response(await getLLMText(page), {
          headers: { "content-type": "text/markdown; charset=utf-8" }
        })
      }
    }
  }
})
