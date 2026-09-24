import { readdirSync, readFileSync } from "node:fs"
import { defineConfig, defineDocs } from "fumadocs-mdx/config"
import type { RemarkAutoTypeTableOptions } from "fumadocs-typescript"
import { createGenerator, remarkAutoTypeTable } from "fumadocs-typescript"

/**
 * Reads the real source types for every API reference table.
 *
 * Its own tsconfig, because the app's covers `src` and would not resolve the
 * package sources. Generating at build time rather than at render time means a
 * renamed or un-exported type fails the build instead of quietly publishing an
 * empty table.
 */
const generator = createGenerator({ tsconfigPath: "tsconfig.docgen.json" })

/**
 * `includeProcessedMarkdown` is what makes `page.data.getText("processed")`
 * available, and that is the whole content of `/llms-full.txt`: the pages after
 * MDX processing, rather than the raw files with their JSX and frontmatter.
 */
export const docs = defineDocs({
  dir: "content/docs",
  docs: { postprocess: { includeProcessedMarkdown: true } }
})

const CONTENT_DIR = "content/docs"
const TYPE_TABLE = /<auto-type-table[^>]*\bname="([^"]+)"/g

/** Each named type table's URL by type name. A reference page wins a tie. */
const typeLinks = new Map<string, string>()

for (const file of readdirSync(CONTENT_DIR, {
  recursive: true,
  encoding: "utf8"
})) {
  if (!file.endsWith(".mdx")) continue

  const slug = file
    .replace(/\.mdx$/, "")
    .split("/")
    .filter((segment) => !segment.startsWith("(") && segment !== "index")
    .join("/")
  const page = slug ? `/docs/${slug}` : "/docs"
  const source = readFileSync(`${CONTENT_DIR}/${file}`, "utf8")

  for (const [, name] of source.matchAll(TYPE_TABLE)) {
    if (!name) continue
    if (!typeLinks.has(name) || page.startsWith("/docs/reference/")) {
      typeLinks.set(name, `${page}#${name}`)
    }
  }
}

interface HastNode {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

// Headings and links already render an <a>.
const UNLINKABLE = new Set(["a", "h1", "h2", "h3", "h4", "h5", "h6"])

/** Wraps every token naming a documented type in a link. */
function linkTypeNames(node: HastNode) {
  for (const child of node.children ?? []) {
    if (child.tagName && UNLINKABLE.has(child.tagName)) continue

    const [text] = child.children ?? []
    const href =
      child.children?.length === 1 &&
      text?.type === "text" &&
      typeLinks.get(String(text.value).trim())

    if (text && href) {
      child.children = [
        {
          type: "element",
          tagName: "a",
          properties: { href, className: ["underline"] },
          children: [text]
        }
      ]
    } else {
      linkTypeNames(child)
    }
  }
}

interface MdastNode {
  type: string
  name?: string
  attributes?: { type: string; name?: string; value?: unknown }[]
  children?: MdastNode[]
}

/** Anchors each type table at its type name. */
function remarkTypeTableIds() {
  function visit(node: MdastNode) {
    for (const child of node.children ?? []) {
      const name = child.attributes?.find(
        (attribute) => attribute.name === "name"
      )
      if (child.name === "auto-type-table" && typeof name?.value === "string") {
        child.attributes?.push(
          { type: "mdxJsxAttribute", name: "id", value: name.value },
          { type: "mdxJsxAttribute", name: "className", value: "scroll-m-28" }
        )
      }
      visit(child)
    }
  }

  return visit
}

const typeTables: RemarkAutoTypeTableOptions = {
  generator,
  shiki: {
    themes: { light: "github-light", dark: "github-dark" },
    transformers: [{ name: "link-type-names", root: linkTypeNames }]
  },
  options: {
    basePath: "../../packages/core/src",
    typeSimplifier: {
      // Default shows "union" and "object" instead.
      override: ({ type, checker, location }) => {
        const text = checker
          .typeToString(type, location)
          .replace(/ \| undefined$/, "")
          .replace(/^\((\(.*\) => .*)\)$/, "$1")

        return text.length <= 60 ? text : undefined
      }
    }
  }
}

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkTypeTableIds, [remarkAutoTypeTable, typeTables]],
    rehypePlugins: [() => linkTypeNames]
  }
})
