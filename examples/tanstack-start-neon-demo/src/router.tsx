import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createRouter as createTanStackRouter } from "@tanstack/react-router"
import { routeTree } from "./routeTree.gen"

/**
 * Builds the router and the query client.
 *
 * One query client per request on the server and one per browser session, which
 * is what keeps one visitor's cached data from being handed to the next.
 */
export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 5000 } }
  })

  return createTanStackRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    scrollRestoration: true,
    Wrap: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  })
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
