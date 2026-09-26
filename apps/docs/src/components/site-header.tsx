import { Link } from "@tanstack/react-router"
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "fumadocs-ui/components/ui/popover"
import {
  FullSearchTrigger,
  SearchTrigger
} from "fumadocs-ui/layouts/shared/slots/search-trigger"
import { ThemeSwitch } from "fumadocs-ui/layouts/shared/slots/theme-switch"
import { Sidebar } from "lucide-react"
import { GitHubIcon } from "~/components/github-icon"
import { tabClassName } from "~/components/section-tabs"
import { navTitle, REPO_URL } from "~/lib/layout.shared"

const LINKS = [
  ["Docs", ""],
  ["Reference", "reference/create-auth"]
]

export function HeaderActions() {
  return (
    <div className="flex items-center gap-2">
      <a
        href={REPO_URL}
        rel="noreferrer noopener"
        target="_blank"
        aria-label="GitHub"
        className="text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-accent-foreground inline-flex items-center justify-center rounded-md p-1.5 transition-colors"
      >
        <GitHubIcon className="size-4.5" />
      </a>
      <ThemeSwitch mode="light-dark-system" />
    </div>
  )
}

// Same layout as the docs header.
export function SiteHeader() {
  return (
    <header className="bg-fd-background/80 sticky top-0 z-40 border-b backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-(--fd-layout-width) gap-2 px-4 md:px-6">
        <div className="flex flex-1 items-center md:flex-none md:pe-4">
          <Link to="/" className="inline-flex items-center">
            {navTitle}
          </Link>
          <nav className="ms-6 flex gap-6 self-stretch max-md:hidden">
            {LINKS.map(([text, splat]) => (
              <Link
                key={text}
                to="/docs/$"
                params={{ _splat: splat }}
                className={tabClassName}
              >
                {text}
              </Link>
            ))}
          </nav>
        </div>
        <FullSearchTrigger
          hideIfDisabled
          className="mx-auto my-auto w-full max-w-sm rounded-xl ps-2.5 max-md:hidden"
        />
        <div className="flex flex-1 items-center justify-end md:flex-none md:ps-4">
          <div className="flex items-center md:hidden">
            <SearchTrigger hideIfDisabled className="p-2" />
            <Popover>
              <PopoverTrigger
                aria-label="Open menu"
                className="hover:bg-fd-accent hover:text-fd-accent-foreground -me-1.5 inline-flex items-center justify-center rounded-md p-2 transition-colors [&_svg]:size-4.5"
              >
                <Sidebar />
              </PopoverTrigger>
              <PopoverContent align="end" className="flex flex-col">
                {LINKS.map(([text, splat]) => (
                  <Link
                    key={text}
                    to="/docs/$"
                    params={{ _splat: splat }}
                    className="hover:bg-fd-accent rounded-md p-2 font-medium transition-colors"
                  >
                    {text}
                  </Link>
                ))}
                <div className="border-fd-border mt-2 border-t pt-2">
                  <HeaderActions />
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="max-md:hidden">
            <HeaderActions />
          </div>
        </div>
      </div>
    </header>
  )
}
