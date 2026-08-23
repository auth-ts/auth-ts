/**
 * Where a client with no cookie jar of its own keeps the auth cookies.
 *
 * The shape of the web `Storage` interface, which is also the shape of the
 * usual native key-value stores, so most can be passed straight through. Use a
 * store the platform protects — the keychain or keystore — because what lands
 * here is the refresh token, the credential that *is* the session.
 */
export interface CookieStorage {
  getItem(key: string): string | null | Promise<string | null>
  setItem(key: string, value: string): void | Promise<void>
  removeItem(key: string): void | Promise<void>
}

/** The one key everything is stored under, as a JSON object of name to value. */
const STORAGE_KEY = "auth-ts.cookies"

/** Holds the auth server's cookies on behalf of a client that cannot. */
export interface CookieJar {
  /** The `Cookie` request header to send, or nothing when the jar is empty. */
  header(): Promise<string | undefined>
  /** Records every `Set-Cookie` on a response, clearing the ones it clears. */
  absorb(response: { headers: Headers }): Promise<void>
}

/**
 * Creates a cookie jar over the given storage.
 *
 * It stands in for the browser: whatever the auth server sets is kept and sent
 * back, and a cookie the server clears is dropped. Nothing is inspected beyond
 * name, value, and `Max-Age` — the jar does not know which cookie is which, and
 * does not need to.
 */
export function createCookieJar(storage: CookieStorage): CookieJar {
  const read = async (): Promise<Record<string, string>> => {
    try {
      const raw = await storage.getItem(STORAGE_KEY)
      const parsed: unknown = raw ? JSON.parse(raw) : null

      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, string>)
        : {}
    } catch {
      return {}
    }
  }

  return {
    async header() {
      const entries = Object.entries(await read())
      if (entries.length === 0) return undefined

      return entries.map(([name, value]) => `${name}=${value}`).join("; ")
    },

    async absorb(response) {
      const set = setCookiesOf(response.headers)
      if (set.length === 0) return

      const cookies = await read()
      for (const header of set) {
        const [pair = "", ...attributes] = header.split(";")
        const separator = pair.indexOf("=")
        if (separator === -1) continue

        const name = pair.slice(0, separator).trim()
        const value = pair.slice(separator + 1).trim()
        const maxAge = attributes
          .map((attribute) => attribute.trim().match(/^max-age=(-?\d+)$/i)?.[1])
          .find((found) => found !== undefined)

        if (maxAge !== undefined && Number(maxAge) <= 0) {
          delete cookies[name]
        } else {
          cookies[name] = value
        }
      }

      if (Object.keys(cookies).length === 0) {
        await storage.removeItem(STORAGE_KEY)
      } else {
        await storage.setItem(STORAGE_KEY, JSON.stringify(cookies))
      }
    }
  }
}

/**
 * The `Set-Cookie` headers of a response, one per cookie.
 *
 * `getSetCookie` is the spec's answer, but a runtime without it folds every
 * cookie into one comma-joined header — and commas also appear inside
 * `Expires` dates, so the split looks ahead for the `name=` that starts the
 * next cookie rather than splitting on every comma.
 */
function setCookiesOf(headers: Headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie()
  }
  const folded = headers.get("set-cookie")

  return folded ? folded.split(/,(?=\s*[^;,\s=]+=)/) : []
}
