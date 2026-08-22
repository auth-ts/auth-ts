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
