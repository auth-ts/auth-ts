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
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover
} from "fumadocs-ui/layouts/notebook/page"
import { Header } from "fumadocs-ui/layouts/notebook/slots/header"
import type { ComponentProps } from "react"
import { OpenAPIPage } from "~/components/api-page"
import { SectionTabs } from "~/components/section-tabs"
import { baseOptions, REPO_URL } from "~/lib/layout.shared"
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
          { title: `${loaderData.title} | auth.ts` },
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
    return { ...shared, type: "docs" as const, path: page.path, url: page.url }
  })

interface PageSource {
  path: string
  url: string
}

const clientLoader = browserCollections.docs.createClientLoader({
  component({ frontmatter, toc, default: MDX }, { path, url }: PageSource) {
    const markdownUrl = `/llms.mdx${url}.md`

    return (
      <DocsPage toc={toc} tableOfContent={{ style: "clerk" }}>
        <DocsTitle>{frontmatter.title}</DocsTitle>
        <DocsDescription>{frontmatter.description}</DocsDescription>
        <div className="border-fd-border -mt-2 flex items-center gap-2 border-b pb-6">
          <MarkdownCopyButton markdownUrl={markdownUrl} />
          <ViewOptionsPopover
            markdownUrl={markdownUrl}
            githubUrl={`${REPO_URL}/blob/main/apps/docs/content/docs/${path}`}
          />
        </div>
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
function MDXContent(page: PageSource) {
  return clientLoader.useContent(page.path, page)
}

// Full width, so its border spans the window.
function FullWidthHeader(props: ComponentProps<"header">) {
  return (
    <Header
      {...props}
      style={{ gridColumn: "1 / -1" }}
      className="border-b *:data-header-body:mx-auto *:data-header-body:w-full *:data-header-body:max-w-[var(--fd-layout-width,97rem)] *:data-header-body:border-b-0"
    />
  )
}

function DocumentationPage() {
  const data = useFumadocsLoader(Route.useLoaderData())
  const options = baseOptions()

  return (
    <NotebookLayout
      {...options}
      nav={{
        ...options.nav,
        mode: "top",
        children: <SectionTabs className="ms-6 self-stretch max-lg:hidden" />
      }}
      sidebar={{
        banner: <SectionTabs className="border-b px-2 lg:hidden" />
      }}
      tabs={false}
      slots={{ header: FullWidthHeader }}
      tree={data.pageTree}
    >
      {data.type === "openapi" ? (
        <DocsPage full>
          <DocsTitle>{data.title}</DocsTitle>
          <DocsDescription>{data.description}</DocsDescription>
          <DocsBody>
            <OpenAPIPage {...data.props} />
          </DocsBody>
        </DocsPage>
      ) : (
        <MDXContent path={data.path} url={data.url} />
      )}
    </NotebookLayout>
  )
}
