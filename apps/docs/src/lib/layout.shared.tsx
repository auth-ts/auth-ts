import { Logo } from "~/components/logo"

/** The GitHub repository, used by the nav link and the landing page. */
export const REPO_URL = "https://github.com/auth-ts/auth-ts"

// One child, so layout gap-2.5 does nothing.
export const navTitle = (
  <span className="inline-flex items-center gap-1.5 font-mono font-semibold">
    <Logo className="text-fd-primary size-6" />
    auth.ts
  </span>
)
