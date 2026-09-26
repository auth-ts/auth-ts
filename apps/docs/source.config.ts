import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { rehypeCodeDefaultOptions } from "fumadocs-core/mdx-plugins"
import { defineConfig, defineDocs } from "fumadocs-mdx/config"
import { transformerTwoslash } from "fumadocs-twoslash"
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
    const [, before = "", name = "", after = ""] =
      /^(\s*)(.*?)(\s*)$/s.exec(String(text?.value)) ?? []
    const href =
      child.children?.length === 1 &&
      text?.type === "text" &&
      typeLinks.get(name)

    if (href) {
      // Keep spaces out of the underline.
      child.children = [
        { type: "text", value: before },
        {
          type: "element",
          tagName: "a",
          properties: { href, className: ["underline"] },
          children: [{ type: "text", value: name }]
        },
        { type: "text", value: after }
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
    node.children = node.children?.map((child) => {
      const name = child.attributes?.find(
        (attribute) => attribute.name === "name"
      )
      if (child.name !== "auto-type-table" || typeof name?.value !== "string") {
        visit(child)
        return child
      }

      // A table id makes rows rewrite the hash.
      return {
        type: "mdxJsxFlowElement",
        name: "div",
        attributes: [
          { type: "mdxJsxAttribute", name: "id", value: name.value },
          { type: "mdxJsxAttribute", name: "className", value: "scroll-m-28" }
        ],
        children: [child]
      }
    })
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

const authDatabaseStub = `import type { AuthDatabase } from "@auth-ts/core"
export declare const authDatabase: AuthDatabase`

const globalsReference =
  '/// <reference path="./globals.d.ts" />\n/// <reference path="./modules.d.ts" />\n'

const twoslash = transformerTwoslash({
  explicitTrigger: false,
  twoslashOptions: {
    filterNode: (node) => {
      if (node.type !== "hover") return true

      // Virtual paths leak this machine and change per run.
      node.text = node.text.replace(/\/[^"'\s]*\/\.twoslash\/\d+\//g, "./")
      // Longer types are unreadable in a popup.
      return node.text.length <= 1000
    },
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      moduleDetection: "force",
      resolveJsonModule: true,
      types: ["node"],
      strict: true
    },
    extraFiles: {
      "index.ts": { prepend: globalsReference },
      "index.tsx": { prepend: globalsReference },
      "globals.d.ts": readFileSync(
        "content/snippets/twoslash/globals.d.ts",
        "utf8"
      ),
      "modules.d.ts": readFileSync(
        "content/snippets/twoslash/modules.d.ts",
        "utf8"
      ),
      "auth.ts": 'export { auth } from "./lib/auth"',
      "schema.ts": readFileSync("content/snippets/schema.ts", "utf8"),
      "jwks.json": '{ "keys": [] }',
      "auth-database.ts": authDatabaseStub,
      "lib/auth-database.ts": authDatabaseStub,
      "lib/auth.ts": readFileSync("content/snippets/auth.ts", "utf8"),
      "lib/auth-client.ts": readFileSync(
        "content/snippets/auth-client.ts",
        "utf8"
      )
    }
  }
})

const MDX_CACHE = "node_modules/.cache/mdx"

// Cache ignores snippets, so drop old runs.
for (const run of existsSync(MDX_CACHE) ? readdirSync(MDX_CACHE) : []) {
  if (run !== String(process.pid))
    rmSync(`${MDX_CACHE}/${run}`, { recursive: true })
}

export default defineConfig({
  // Server build reuses the client's compiled pages.
  experimentalBuildCache: `${MDX_CACHE}/${process.pid}`,
  mdxOptions: {
    remarkPlugins: [remarkTypeTableIds, [remarkAutoTypeTable, typeTables]],
    rehypePlugins: [() => linkTypeNames],
    rehypeCodeOptions: {
      ...rehypeCodeDefaultOptions,
      transformers: [...(rehypeCodeDefaultOptions.transformers ?? []), twoslash]
    }
  }
})
