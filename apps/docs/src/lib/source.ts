import type { Node } from "fumadocs-core/page-tree"
import { loader } from "fumadocs-core/source"
import { icons } from "lucide-react"
import { createElement } from "react"
import { OpenAPIIcon } from "~/components/openapi-icon"
import { docs } from "../../.source/server"
import { openapi, operationOrder } from "./openapi"

/** The documentation tree, loaded from `content/docs` and the API reference. */
const RANKS = new Map(operationOrder.map((entry) => [entry.id, entry]))

function operationId(node: Node) {
  return node.type === "page" ? (node.url.split("/").pop() ?? "") : ""
}

/**
 * Orders the generated routes and heads each run with its tag.
 *
 * The tree arrives sorted by file name, which is the operation id, so the
 * routes read as scattered. Separators are inserted rather than folders so the
 * URLs stay flat.
 */
function groupByTag(children: Node[]) {
  const ordered = [...children].sort(
    (left, right) =>
      (RANKS.get(operationId(left))?.rank ?? Number.MAX_SAFE_INTEGER) -
      (RANKS.get(operationId(right))?.rank ?? Number.MAX_SAFE_INTEGER)
  )

  const grouped: Node[] = []
  let heading: string | undefined
  for (const child of ordered) {
    const tag = RANKS.get(operationId(child))?.tag
    if (tag && tag !== heading) {
      heading = tag
      grouped.push({ type: "separator", name: tag })
    }
    grouped.push(child)
  }

  return grouped
}

export const source = loader({
  baseUrl: "/docs",
  source: {
    docs: docs.toFumadocsSource(),
    openapi: await openapi.staticSource({
      baseDir: "api",
      per: "custom",
      // The default titles each page by its summary, which reads as a sentence
      // in a sidebar and repeats what the page already says. The route is the
      // thing a reader is scanning for, so it is the title; the summary moves
      // to the description, and the method badge is rendered alongside.
      // Paths are relative to the server, so they need no trimming.
      toPages(builder) {
        for (const operation of builder.extract().operations) {
          const resolved = builder.fromExtractedOperation(operation)
          if (!resolved) continue

          builder.create({
            type: "operation",
            schemaId: builder.id,
            item: operation,
            path: `${resolved.operation.operationId ?? operation.path}.mdx`,
            info: {
              // Shown without the mount: every route shares that prefix, and a
              // sidebar truncates the tail, which is the part that differs.
              title: operation.path,
              description: resolved.operation.summary,
              deprecated: resolved.operation.deprecated
            }
          })
        }
      }
    })
  },
  plugins: [openapi.loaderPlugin()],
  pageTree: {
    transformers: [
      {
        folder(node, folderPath) {
          if (folderPath !== "api") return node

          return {
            ...node,
            name: "OpenAPI",
            icon: createElement(OpenAPIIcon, { className: "size-4" }),
            children: groupByTag(node.children)
          }
        }
      }
    ]
  },
  /**
   * Resolves the `icon` name a page's frontmatter or a folder's `meta.json`
   * declares into the Lucide component of that name. An unknown name renders
   * nothing rather than throwing, so a typo costs an icon, not the page.
   */
  icon(icon) {
    if (icon && icon in icons) {
      return createElement(icons[icon as keyof typeof icons])
    }
  }
})

/**
 * One page rendered as the Markdown an LLM should read.
 *
 * The processed text is used rather than the raw file so the output carries no
 * frontmatter or JSX — an `<auto-type-table />` in the source becomes the
 * generated table here, which is the part worth reading. An API page has no
 * prose at all, so it contributes its schema instead.
 */
export async function getLLMText(page: (typeof source)["$inferPage"]) {
  if (page.type === "openapi") {
    return `# ${page.data.title} (${page.url})\n\n${JSON.stringify(page.data.getSchema().bundled, null, 2)}`
  }

  const processed = await page.data.getText("processed")

  return `# ${page.data.title} (${page.url})\n\n${processed}`
}
