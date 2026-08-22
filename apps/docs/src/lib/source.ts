import { loader } from "fumadocs-core/source"
import { icons } from "lucide-react"
import { createElement } from "react"
import { docs } from "../../.source/server"

/** The documentation tree, loaded from `content/docs`. */
export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
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
 * generated table here, which is the part worth reading.
 */
export async function getLLMText(page: (typeof source)["$inferPage"]) {
  const processed = await page.data.getText("processed")

  return `# ${page.data.title} (${page.url})\n\n${processed}`
}
