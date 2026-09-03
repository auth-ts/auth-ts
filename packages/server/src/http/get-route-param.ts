/**
 * Splits a request path into the segments below `basePath`.
 *
 * Tolerates a trailing slash on either side and percent-decodes each segment, so
 * `/identities/abc%2Fdef/token` yields one segment containing a slash rather than two
 * segments — a decoded separator must never become a path boundary.
 *
 * @returns The segments, or `null` when the path is outside the mount.
 */
export function splitPathSegments(pathname: string, basePath: string) {
  const normalizedBase = basePath.replace(/\/+$/, "")
  if (pathname !== normalizedBase && !pathname.startsWith(`${normalizedBase}/`))
    return null

  const rawSegments = pathname
    .slice(normalizedBase.length)
    .split("/")
    .filter((segment) => segment.length > 0)

  // decodeURIComponent throws on a malformed sequence — "%zz", a trailing "%",
  // a truncated multibyte escape — and a URL pathname keeps those verbatim, so
  // they arrive here from any client. That is not a route we serve, not an
  // internal error: return null and let the caller answer 404.
  try {
    return rawSegments.map((segment) => decodeURIComponent(segment))
  } catch {
    return null
  }
}
