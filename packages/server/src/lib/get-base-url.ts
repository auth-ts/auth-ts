import type { AuthServerConfig } from "../core/auth-server-config"
import { AuthConfigError } from "../http/auth-config-error"

/**
 * Reads a forwarded header's first entry.
 *
 * Each proxy in a chain appends to these, so the leftmost entry is the one the
 * browser named and everything after it is a hop. Any other entry names a proxy
 * rather than the site.
 */
function firstEntry(value: string | null | undefined) {
  const first = value?.split(",")[0]?.trim()
  return first ? first : undefined
}

/**
 * The origin the request names, preferring what a proxy forwarded.
 *
 * Behind a reverse proxy the URL the runtime sees is the internal one —
 * `http://localhost:3000` on most platforms — while `X-Forwarded-Host` and
 * `X-Forwarded-Proto` carry the origin the browser actually used. Normalized
 * through `URL` so a header carrying a path, a port, or plain nonsense can
 * never produce anything but an origin.
 */
export function getRequestOrigin(requestURL: string, headers?: Headers) {
  let url: URL
  try {
    url = new URL(requestURL)
  } catch {
    return undefined
  }

  const host = firstEntry(headers?.get("x-forwarded-host")) ?? url.host
  const protocol =
    firstEntry(headers?.get("x-forwarded-proto")) ??
    url.protocol.replace(/:$/, "")
  if (protocol !== "http" && protocol !== "https") return url.origin

  try {
    return new URL(`${protocol}://${host}`).origin
  } catch {
    return url.origin
  }
}

/**
 * The absolute origin this server is reached at.
 *
 * `baseURL` when one is configured, and otherwise the origin the request names.
 * Deriving it is what lets `baseURL` stay optional: a single-origin app,
 * including one behind a proxy, needs no origin configured anywhere.
 *
 * The OAuth redirect URI built from this is not a trust boundary by itself. A
 * provider only ever redirects to a URI registered in its own console, so a
 * forged `Host` yields an error page at the provider rather than an
 * authorization code delivered somewhere else. Configure `baseURL` when the
 * canonical origin should be pinned regardless — a proxy that does not forward
 * the host, or a deployment that answers on several origins but must always
 * name one.
 *
 * @throws {AuthConfigError} When there is nothing to derive from: an endpoint
 * called in-process without a request, on a server with no `baseURL`.
 */
export function getBaseURL(
  config: AuthServerConfig,
  requestURL?: string,
  headers?: Headers
) {
  if (config.baseURL) return config.baseURL

  const origin = requestURL ? getRequestOrigin(requestURL, headers) : undefined
  if (!origin) {
    throw new AuthConfigError(
      "Cannot determine this server's origin: no baseURL is configured and this call carried no request to derive one from. Pass the request's headers and requestURL, or set baseURL."
    )
  }

  return origin
}
