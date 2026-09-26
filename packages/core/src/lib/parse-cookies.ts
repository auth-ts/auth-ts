/**
 * Parses a `Cookie` request header into a name → value map.
 *
 * Values are percent-decoded to mirror {@link serializeCookie}, which encodes
 * them. Unparseable pairs are skipped rather than throwing: a malformed cookie
 * from some unrelated script must not take down authentication.
 *
 * A name that appears more than once with differing values is dropped entirely.
 * The header carries no `Path` or `Domain`, so the server cannot tell which copy
 * is its own — and picking either by position is exactly what cookie tossing
 * exploits: a sibling subdomain adds a same-named cookie it controls, and the
 * browser's ordering decides whose session or OAuth state gets honoured.
 * Refusing to guess turns that into a failed request instead of a fixated one.
 * Identical duplicates are harmless and keep resolving.
 */
export function parseCookies(cookieHeader: string | null | undefined) {
  const cookies = new Map<string, string>()
  if (!cookieHeader) return cookies

  const conflicting = new Set<string>()

  for (const segment of cookieHeader.split(";")) {
    const separatorIndex = segment.indexOf("=")
    if (separatorIndex === -1) continue

    const name = segment.slice(0, separatorIndex).trim()
    if (!name || conflicting.has(name)) continue

    const rawValue = segment.slice(separatorIndex + 1).trim()
    let value: string
    try {
      value = decodeURIComponent(rawValue)
    } catch {
      value = rawValue
    }

    const seen = cookies.get(name)
    if (seen === undefined) {
      cookies.set(name, value)
    } else if (seen !== value) {
      cookies.delete(name)
      conflicting.add(name)
    }
  }

  return cookies
}

const parsed = new WeakMap<
  Headers,
  { header: string | null; cookies: Map<string, string> }
>()

/**
 * The request's cookies, parsed once per `Headers` object.
 *
 * A request's header is read several times on the hot path — the refresh map,
 * the hint, the re-send — and each read costs a full parse without this. Keyed
 * by the `Headers` instance and checked against the raw header, so a mutated
 * header re-parses rather than answering stale. Callers must not mutate the
 * returned map.
 */
export function requestCookies(headers: Headers) {
  const header = headers.get("cookie")
  const cached = parsed.get(headers)
  if (cached && cached.header === header) return cached.cookies

  const cookies = parseCookies(header)
  parsed.set(headers, { header, cookies })
  return cookies
}

/** Reads a single cookie from a `Headers` object, or `undefined` when absent. */
export function readCookie(headers: Headers, name: string) {
  return requestCookies(headers).get(name)
}
