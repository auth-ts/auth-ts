import { createRouter as createTanStackRouter } from "@tanstack/react-router"
import { NotFound } from "~/components/not-found"
import { routeTree } from "./routeTree.gen"

/** Builds the router. Named `getRouter` because that is what TanStack Start imports. */
export function getRouter() {
  return createTanStackRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
    defaultNotFoundComponent: NotFound
  })
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
