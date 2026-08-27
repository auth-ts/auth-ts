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
 *
 * The forwarded headers are read only when `trustProxyHeaders` says a proxy
 * sets them. Nothing about a request distinguishes a header a proxy wrote from
 * one its sender did, and this origin is both what the OAuth `redirect_uri` is
 * built from and an entry in the origin check's allowlist — so reading them
 * unasked would let a caller nominate the origin it is then checked against.
 */
export function getRequestOrigin(
  requestURL: string,
  headers?: Headers,
  trustProxyHeaders = false
) {
  let url: URL
  try {
    url = new URL(requestURL)
  } catch {
    return undefined
  }
  if (!trustProxyHeaders) return url.origin

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
 * `baseURL` when one is configured, and otherwise the origin the request names
 * — the request URL's own, or what a proxy forwarded once `trustedProxyHeaders`
 * is on. Deriving it is what lets `baseURL` stay optional: a single-origin app
 * needs no origin configured anywhere.
 *
 * `baseURL` wins outright rather than being one candidate among several, so a
 * deployment that pins its origin cannot have it moved by a header.
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

  const origin = requestURL
    ? getRequestOrigin(requestURL, headers, config.trustedProxyHeaders)
    : undefined
  if (!origin) {
    throw new AuthConfigError(
      "Cannot determine this server's origin: no baseURL is configured and this call carried no request to derive one from. Pass the request's headers and requestURL, or set baseURL."
    )
  }

  return origin
}
