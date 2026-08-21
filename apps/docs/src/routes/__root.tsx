import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts
} from "@tanstack/react-router"
import { RootProvider } from "fumadocs-ui/provider/tanstack"
import type { ReactNode } from "react"
import styles from "../styles.css?url"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "auth-ts" },
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
        <RootProvider>{children}</RootProvider>
        <Scripts />
      </body>
    </html>
  )
}
