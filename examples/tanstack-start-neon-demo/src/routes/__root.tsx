import type { QueryClient } from "@tanstack/react-query"
import {
  createRootRouteWithContext,
  HeadContent,
  Link,
  Outlet,
  Scripts
} from "@tanstack/react-router"
import styles from "../styles.css?url"

/**
 * The application shell.
 *
 * Deliberately does not resolve the session: the user is read in the browser
 * through `useUser`, so there is no server-rendered "optimistic" user. On a
 * server that would be an authorization decision made from a render hint, which
 * is the kind of thing that becomes a 1am phone call.
 */
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    head: () => ({
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: "auth-ts demo" }
      ],
      links: [{ rel: "stylesheet", href: styles }]
    }),
    component: RootComponent
  }
)

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen bg-neutral-50 text-neutral-900">
        <header className="border-b border-neutral-200 bg-white">
          <nav className="mx-auto flex max-w-3xl items-center gap-4 px-6 py-4 text-sm">
            <Link to="/" className="font-medium">
              Todos
            </Link>
            <Link to="/account">Account</Link>
            <Link to="/login" className="ml-auto">
              Sign in
            </Link>
          </nav>
        </header>

        <main className="mx-auto max-w-3xl px-6 py-10">
          <Outlet />
        </main>

        <Scripts />
      </body>
    </html>
  )
}
