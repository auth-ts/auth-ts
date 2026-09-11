import type { Folder, Node } from "fumadocs-core/page-tree"
import { loader } from "fumadocs-core/source"
import { icons } from "lucide-react"
import { createElement } from "react"
import { OpenAPIIcon } from "~/components/openapi-icon"
import { docs } from "../../.source/server"
import { openapi, routeSegments, tagOrder, tagSlug } from "./openapi"

const BASE_DIR = "open-api"
const TAG_BY_SLUG = new Map(tagOrder.map((tag) => [tagSlug(tag), tag]))

function rankOf(node: Node) {
  const slug =
    node.type === "folder" ? node.$ref?.folder.split("/").pop() : undefined
  const tag = slug ? TAG_BY_SLUG.get(slug) : undefined

  return tag ? tagOrder.indexOf(tag) : Number.MAX_SAFE_INTEGER
}

/** Every page beneath a node, however many folder levels it takes to reach one. */
function leaves(node: Node): Node[] {
  return node.type === "folder" ? node.children.flatMap(leaves) : [node]
}

/**
 * Titles the OpenAPI root and its tag folders, and orders both by tag.
 *
 * The URL nests one level per path segment below the tag, method included, so
 * it reads the way the rendered reference's own anchors do. Those levels are
 * flattened back out of the sidebar here, so a tag's entry is a flat list
 * rather than a fold for every method and every path segment to sit behind.
 */
function openAPIFolder(node: Folder, folderPath: string) {
  if (folderPath === BASE_DIR) {
    return {
      ...node,
      name: "OpenAPI",
      icon: createElement(OpenAPIIcon, { className: "size-4" }),
      children: [...node.children].sort(
        (left, right) => rankOf(left) - rankOf(right)
      )
    }
  }

  const segments = folderPath.split("/")
  if (segments.length !== 2 || segments[0] !== BASE_DIR) return node

  const tag = TAG_BY_SLUG.get(segments[1] ?? "")
  if (!tag) return node

  return { ...node, name: tag, children: node.children.flatMap(leaves) }
}

export const source = loader({
  baseUrl: "/docs",
  source: {
    docs: docs.toFumadocsSource(),
    openapi: await openapi.staticSource({
      baseDir: BASE_DIR,
      per: "custom",
      // The default titles each page by its summary, which reads as a sentence
      // in a sidebar and repeats what the page already says. The route is the
      // thing a reader is scanning for, so it is the title; the summary moves
      // to the description, and the method badge is rendered alongside.
      // One folder per tag, and the file itself named after the method and
      // route — the same shape the rendered reference's own anchors use.
      toPages(builder) {
        for (const operation of builder.extract().operations) {
          const resolved = builder.fromExtractedOperation(operation)
          if (!resolved) continue

          const tag = resolved.operation.tags?.[0] ?? "Untagged"
          const method = operation.method.toLowerCase()
          const segments = [
            tagSlug(tag),
            method,
            ...routeSegments(operation.path)
          ]

          builder.create({
            type: "operation",
            schemaId: builder.id,
            item: operation,
            path: `${segments.join("/")}.mdx`,
            info: {
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
    transformers: [{ folder: openAPIFolder }]
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
