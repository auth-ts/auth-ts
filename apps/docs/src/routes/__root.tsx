import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts
} from "@tanstack/react-router"
import { RootProvider } from "fumadocs-ui/provider/tanstack"
import { lazy, type ReactNode } from "react"
import styles from "../styles.css?url"

// Loaded on demand: the search index and its engine are far larger than the
// page that opens them, and most visitors never press the key.
const SearchDialog = lazy(() => import("~/components/search"))

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Auth.ts" },
      {
        name: "description",
        content:
          "Free forever JWT auth in TypeScript — callbacks to write into any database."
      }
    ],
    links: [{ rel: "stylesheet", href: styles }]
  }),
  component: RootComponent
})

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="flex min-h-screen flex-col">
        <RootProvider
          search={{ SearchDialog }}
          theme={{ defaultTheme: "system", enableSystem: true }}
        >
          {children}
        </RootProvider>
        <Scripts />
      </body>
    </html>
  )
}
