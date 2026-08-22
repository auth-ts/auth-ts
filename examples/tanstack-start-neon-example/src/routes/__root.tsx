import type { QueryClient } from "@tanstack/react-query"
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts
} from "@tanstack/react-router"

import { Header } from "../components/header"
import styles from "../styles/app.css?url"

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    head: () => ({
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: "Auth.ts Demo" }
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

      <body className="min-h-screen bg-base-200 text-base-content">
        <Header />

        <main className="mx-auto max-w-3xl px-4 py-10">
          <Outlet />
        </main>

        <Scripts />
      </body>
    </html>
  )
}
