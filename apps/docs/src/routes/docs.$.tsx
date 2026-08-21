import { createFileRoute, notFound } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { DocsLayout } from "fumadocs-ui/layouts/docs"
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle
} from "fumadocs-ui/page"
import { Logo } from "~/components/logo"
import { source } from "~/lib/source"
import { getMDXComponents } from "~/mdx-components"
import browserCollections from "../../.source/browser.ts"

export const Route = createFileRoute("/docs/$")({
  component: DocumentationPage,
  loader: async ({ params }) => {
    const data = await loadPage({
      data: params._splat?.split("/").filter(Boolean) ?? []
    })
    await clientLoader.preload(data.path)

    return data
  }
})

const loadPage = createServerFn({ method: "GET" })
  .validator((slugs: string[]) => slugs)
  .handler(async ({ data: slugs }) => {
    const page = source.getPage(slugs)
    if (!page) throw notFound()

    return { path: page.path }
  })

const clientLoader = browserCollections.docs.createClientLoader({
  component({ frontmatter, default: MDX }) {
    return (
      <DocsPage>
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
    <DocsLayout
      tree={source.pageTree}
      nav={{
        title: (
          <>
            <Logo className="size-5" />
            Auth.ts
          </>
        )
      }}
    >
      {clientLoader.useContent(data.path)}
    </DocsLayout>
  )
}
