import { HomeLayout } from "fumadocs-ui/layouts/home"
import { DefaultNotFound } from "fumadocs-ui/layouts/home/not-found"
import { baseOptions } from "~/lib/layout.shared"

/**
 * The 404 page.
 *
 * Wrapped in `HomeLayout` so a mistyped URL still arrives somewhere that looks
 * like the site — with the nav, the search, and a way back — instead of the
 * router's bare unstyled default.
 */
export function NotFound() {
  return (
    <HomeLayout {...baseOptions()}>
      <DefaultNotFound />
    </HomeLayout>
  )
}
