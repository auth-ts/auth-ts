import { HINT_COOKIE_NAME } from "../../shared/hint-cookie"
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

/** Browser hints never decide native session state. */
export function mayHaveSession(config: AuthClientConfig) {
  if (config.sessionStorage) return true

  const cookies = globalThis.document?.cookie
  if (cookies === undefined) return true

  let hint: string | undefined
  for (const entry of cookies.split(";")) {
    const separator = entry.indexOf("=")
    if (separator === -1) continue
    if (entry.slice(0, separator).trim() !== HINT_COOKIE_NAME) continue

    // Two hints that disagree are cookie tossing
    const value = entry.slice(separator + 1).trim()
    if (hint !== undefined && hint !== value) return true
    hint = value
  }

  // The hint carries the active user's id, so anything non-empty other than
  // the explicit `out` is a session. A cookie left empty by a browser
  // mid-deletion, or written by something else under the same name, is
  // treated as no hint rather than as a verdict.
  if (hint === "out") return false
  if (hint) return true

  return isCrossOrigin(config.baseURL)
}
