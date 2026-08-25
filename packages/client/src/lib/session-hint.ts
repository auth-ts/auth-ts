import { HINT_COOKIE_NAME } from "@auth-ts/server"
import type { AuthClientConfig } from "../core/auth-client-config"

/** Whether the auth server is on a different origin than the page. */
function isCrossOrigin(baseURL: string) {
  const here = globalThis.location?.origin
  if (!baseURL || !here) return false

  try {
    return new URL(baseURL, here).origin !== here
  } catch {
    return false
  }
}

/**
 * Whether asking the server for a token could produce one.
 *
 * `false` only when the browser positively says there is no session: the server
 * writes a readable hint cookie beside the refresh cookie and retires the two
 * together, so a browser that has one has both. That is what makes a signed-out
 * visitor cost nothing — no request on load, none on every tab focus, and no
 * refused response in the console for what is not a failure.
 *
 * Absence is only an answer where the hint is guaranteed deliverable, which
 * means same-origin. A cross-origin deployment receives it only if the two
 * hosts share a registrable domain the browser accepts, so there the server
 * writes an explicit `out` and a missing hint is treated as "ask" — one wasted
 * request, rather than a signed-in visitor rendered as a stranger.
 *
 * A runtime with no `document`, or one holding its own cookie jar, is not a
 * browser and never consults this: it either has the refresh cookie or does not.
 */
export function mayHaveSession(config: AuthClientConfig) {
  if (config.cookieStorage) return true

  const cookies = globalThis.document?.cookie
  if (cookies === undefined) return true

  for (const entry of cookies.split(";")) {
    const separator = entry.indexOf("=")
    if (separator === -1) continue
    if (entry.slice(0, separator).trim() !== HINT_COOKIE_NAME) continue

    // The hint carries the active user's id, so anything non-empty other than
    // the explicit `out` is a session. A cookie left empty by a browser
    // mid-deletion, or written by something else under the same name, is
    // treated as no hint rather than as a verdict.
    const value = entry.slice(separator + 1).trim()
    if (value === "out") return false
    if (value) return true
    break
  }

  return isCrossOrigin(config.baseURL)
}
