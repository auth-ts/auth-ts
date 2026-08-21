import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared"
import { Logo } from "~/components/logo"

/** The GitHub repository, used by the nav link and the landing page. */
export const REPO_URL = "https://github.com/auth-ts/auth-ts"

/**
 * The navbar shared by the landing page and the docs.
 *
 * Both layouts read from here so the header does not drift between them: the
 * same mark, the same search and theme controls on every route. Nav links are
 * deliberately not set here — `DocsLayout` renders them into the sidebar above
 * the page tree, where a link back to the docs is only noise.
 */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          <Logo className="size-5" />
          Auth.ts
        </>
      )
    },
    githubUrl: REPO_URL,
    // Three-way, not the default two-way toggle: without "system" in the
    // switch, the first click strands the reader on an explicit light or dark
    // with no way back to following the OS.
    themeSwitch: { mode: "light-dark-system" }
  }
}
