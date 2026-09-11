import { createFileRoute, notFound } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { useFumadocsLoader } from "fumadocs-core/source/client"
import { DocsLayout as NotebookLayout } from "fumadocs-ui/layouts/notebook"
// The notebook layout ships its own page module; the generic `fumadocs-ui/page`
// is the docs layout's, and the two lay their table of contents out differently.
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle
} from "fumadocs-ui/layouts/notebook/page"
import { OpenAPIPage } from "~/components/api-page"
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
    if (data.type === "docs") await clientLoader.preload(data.path)

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

// The tree is serialized rather than read in the component: it carries React
// nodes for icons, and `lib/source` now reaches the filesystem to build the API
// pages, so it cannot be imported into the browser bundle at all.
const loadPage = createServerFn({ method: "GET" })
  .validator((slugs: string[]) => slugs)
  .handler(async ({ data: slugs }) => {
    const page = source.getPage(slugs)
    if (!page) throw notFound()

    const pageTree = await source.serializePageTree(source.pageTree)
    const shared = {
      title: page.data.title,
      description: page.data.description,
      pageTree
    }

    if (page.type === "openapi") {
      return {
        ...shared,
        type: "openapi" as const,
        props: page.data.getOpenAPIPageProps()
      }
    }

    // Title and description travel with the path so the document head can be
    // rendered before the MDX chunk has loaded.
    return { ...shared, type: "docs" as const, path: page.path }
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

// Two components rather than a branch inside one: `useContent` is a hook, and a
// reader moving between an API page and a prose page would otherwise change how
// many hooks render.
function MDXContent({ path }: { path: string }) {
  return clientLoader.useContent(path)
}

function DocumentationPage() {
  const data = useFumadocsLoader(Route.useLoaderData())

  return (
    <NotebookLayout {...baseOptions()} tree={data.pageTree}>
      {data.type === "openapi" ? (
        <DocsPage full>
          <DocsTitle>{data.title}</DocsTitle>
          <DocsDescription>{data.description}</DocsDescription>
          <DocsBody>
            <OpenAPIPage {...data.props} />
          </DocsBody>
        </DocsPage>
      ) : (
        <MDXContent path={data.path} />
      )}
    </NotebookLayout>
  )
}
