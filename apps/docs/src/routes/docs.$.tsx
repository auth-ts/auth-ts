import { createFileRoute, notFound } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { DocsLayout as NotebookLayout } from "fumadocs-ui/layouts/notebook"
// The notebook layout ships its own page module; the generic `fumadocs-ui/page`
// is the docs layout's, and the two lay their table of contents out differently.
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle
} from "fumadocs-ui/layouts/notebook/page"
import { baseOptions } from "~/lib/layout.shared"
import { source } from "~/lib/source"
import { getMDXComponents } from "~/mdx-components"
import browserCollections from "../../.source/browser"

export const Route = createFileRoute("/docs/$")({
  component: DocumentationPage,
  loader: async ({ params }) => {
    const data = await loadPage({
      data: params._splat?.split("/").filter(Boolean) ?? []
    })
    await clientLoader.preload(data.path)

    return data
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.title} | Auth.ts` },
          { name: "description", content: loaderData.description }
        ]
      : []
  })
})

const loadPage = createServerFn({ method: "GET" })
  .validator((slugs: string[]) => slugs)
  .handler(async ({ data: slugs }) => {
    const page = source.getPage(slugs)
    if (!page) throw notFound()

    // Title and description travel with the path so the document head can be
    // rendered before the MDX chunk has loaded.
    return {
      path: page.path,
      title: page.data.title,
      description: page.data.description
    }
  })

const clientLoader = browserCollections.docs.createClientLoader({
  component({ frontmatter, toc, default: MDX }) {
    return (
      <DocsPage toc={toc}>
        <DocsTitle>{frontmatter.title}</DocsTitle>
        <DocsDescription>{frontmatter.description}</DocsDescription>
        <DocsBody>
          <MDX components={getMDXComponents()} />
        </DocsBody>
      </DocsPage>
    )
  }
})

function DocumentationPage() {
  const data = Route.useLoaderData()

  // The tree is read directly rather than returned from the server function:
  // it carries React nodes for icons, which cannot cross that boundary.
  return (
    <NotebookLayout {...baseOptions()} tree={source.pageTree}>
      {clientLoader.useContent(data.path)}
    </NotebookLayout>
  )
}
