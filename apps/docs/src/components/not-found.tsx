import { HomeLayout } from "fumadocs-ui/layouts/home"
import { DefaultNotFound } from "fumadocs-ui/layouts/home/not-found"
import { SiteHeader } from "~/components/site-header"

/**
 * The 404 page.
 *
 * Wrapped in `HomeLayout` so a mistyped URL still arrives somewhere that looks
 * like the site — with the nav, the search, and a way back — instead of the
 * router's bare unstyled default.
 */
export function NotFound() {
  return (
    <HomeLayout
      nav={{ component: <SiteHeader /> }}
      className="[--fd-layout-width:97rem]"
    >
      <DefaultNotFound />
    </HomeLayout>
  )
}
