/**
 * Parses a `Cookie` request header into a name → value map.
 *
 * Values are percent-decoded to mirror {@link serializeCookie}, which encodes
 * them. Unparseable pairs are skipped rather than throwing: a malformed cookie
 * from some unrelated script must not take down authentication.
 */
export function parseCookies(cookieHeader: string | null | undefined) {
  const cookies = new Map<string, string>()
  if (!cookieHeader) return cookies

  for (const segment of cookieHeader.split(";")) {
    const separatorIndex = segment.indexOf("=")
    if (separatorIndex === -1) continue

    const name = segment.slice(0, separatorIndex).trim()
    if (!name) continue

    const rawValue = segment.slice(separatorIndex + 1).trim()
    try {
      cookies.set(name, decodeURIComponent(rawValue))
    } catch {
      cookies.set(name, rawValue)
    }
  }

  return cookies
}

/** Reads a single cookie from a `Headers` object, or `undefined` when absent. */
export function readCookie(headers: Headers, name: string) {
  return parseCookies(headers.get("cookie")).get(name)
}
