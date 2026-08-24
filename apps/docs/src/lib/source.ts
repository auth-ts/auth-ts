import { loader } from "fumadocs-core/source"
import { icons } from "lucide-react"
import { createElement } from "react"
import { docs } from "../../.source/server"
import { openapi } from "./openapi"

/** The documentation tree, loaded from `content/docs` and the API reference. */
export const source = loader({
  baseUrl: "/docs",
  source: {
    docs: docs.toFumadocsSource(),
    openapi: await openapi.staticSource({ baseDir: "api" })
  },
  plugins: [openapi.loaderPlugin()],
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
