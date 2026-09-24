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

const typeTables: RemarkAutoTypeTableOptions = {
  generator,
  options: {
    basePath: "../../packages/core/src",
    typeSimplifier: {
      // Default shows "union" and "object" instead.
      override: ({ type, location }) => {
        const members = type
          .getText(location)
          .split(" | ")
          .filter((member) => member !== "undefined")
        const joined = members.join(" | ")
        const text =
          members.length === 1 ? joined.replace(/^\((.*)\)$/, "$1") : joined

        return text.length <= 40 ? text : undefined
      }
    }
  }
}

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [[remarkAutoTypeTable, typeTables]]
  }
})
