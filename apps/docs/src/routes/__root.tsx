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
      { title: "Auth.ts | Free forever auth" },
      {
        name: "description",
        content:
          "Free forever JWT auth in TypeScript — four functions to write against any database."
      },
      // The home-screen label, which has room for far less than the title.
      { name: "apple-mobile-web-app-title", content: "Auth.ts" }
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
        {/*
         * Written into the document rather than the route's `links`: these are
         * the same on every route, so route-level head management buys nothing,
         * and React's head hoisting drops them on the way through it.
         *
         * The .ico comes first and the SVG second with `sizes="any"` — browsers
         * that understand SVG icons prefer it on that hint, and the rest stop at
         * the first entry they can read.
         */}
        <link rel="icon" href="/favicon.ico" sizes="48x48" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" sizes="any" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />
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
