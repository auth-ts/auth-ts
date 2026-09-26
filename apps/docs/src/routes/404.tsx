import { createFileRoute } from "@tanstack/react-router"
import { NotFound } from "~/components/not-found"

/**
 * The not-found page as a real route, so it can be prerendered.
 *
 * The site is static: Cloudflare Pages answers anything matching no file with
 * `404.html`, and that file has to exist for a cold visit to a dead link to
 * land anywhere but Cloudflare's own generic page. Prerendering the route
 * TanStack already renders for a client-side miss keeps both paths on the same
 * component. See `vite.config.ts` for the entry that writes it.
 */
export const Route = createFileRoute("/404")({
  component: NotFound
})
