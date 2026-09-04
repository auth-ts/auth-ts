/** Builds a `Request` for an auth route, with optional JSON body and cookies. */
export function request(
  method: string,
  path: string,
  options: {
    body?: unknown
    cookies?: Record<string, string>
    headers?: Record<string, string>
    origin?: string
    /** Presented as `Authorization: Bearer`, the way every client sends one. */
    token?: string
  } = {}
) {
  const origin = options.origin ?? "https://app.example.com"
  const headers = new Headers(options.headers)

  if (options.cookies && Object.keys(options.cookies).length > 0) {
    headers.set(
      "cookie",
      Object.entries(options.cookies)
        .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
        .join("; ")
    )
  }

  if (options.token) headers.set("authorization", `Bearer ${options.token}`)

  if (options.body !== undefined)
    headers.set("content-type", "application/json")

  return new Request(`${origin}${path}`, {
    method,
    headers,
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) })
  })
}

/** The cookie one user's refresh token rides in, mirroring `refreshCookieName`. */
export function refreshCookie(userId: string) {
  return `auth-ts.refresh.${userId}`
}

/** Cookie header entries for a browser holding these users' refresh tokens. */
export function refreshCookies(tokens: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(tokens).map(([userId, token]) => [
      refreshCookie(userId),
      token
    ])
  )
}

/**
 * Cookie entries for one refresh token.
 *
 * The id defaults because the server reads whichever refresh cookie it is
 * given; it only has to be real where several users are signed in at once, or
 * where an endpoint targets one of them by id.
 */
export function refreshCookieFor(token: string, userId = "signed-in") {
  return { [refreshCookie(userId)]: token }
}

/** Extracts cookie name → value from a response's `Set-Cookie` headers. */
export function readSetCookies(response: Response | { headers: Headers }) {
  const cookies = new Map<string, { value: string; attributes: string }>()

  for (const setCookie of response.headers.getSetCookie()) {
    const [pair = "", ...attributes] = setCookie.split(";")
    const separatorIndex = pair.indexOf("=")
    if (separatorIndex === -1) continue

    cookies.set(pair.slice(0, separatorIndex).trim(), {
      value: decodeURIComponent(pair.slice(separatorIndex + 1).trim()),
      attributes: attributes.join(";")
    })
  }

  return cookies
}

/** The refresh entry in an already-parsed cookie map, whichever user it names. */
export function refreshEntryOf(
  cookies: Map<string, { value: string; attributes: string }>
) {
  const refresh = [...cookies].filter(([name]) =>
    name.startsWith("auth-ts.refresh.")
  )

  // A response may clear one user's cookie while setting another's — a guest
  // being converted does exactly that — so a live cookie wins over a cleared
  // one, and a lone cleared one is still the answer.
  return (refresh.find(([, entry]) => entry.value !== "") ?? refresh[0])?.[1]
}

/** The refresh cookie a response set, whichever user it names. */
export function readRefreshCookie(
  response: Response | { headers: Headers },
  userId?: string
) {
  const cookies = readSetCookies(response)
  if (userId !== undefined) return cookies.get(refreshCookie(userId))

  return refreshEntryOf(cookies)
}

/** Exchanges a refresh cookie for an access token, the way a client boots. */
export async function mintToken(
  auth: { handler: (request: Request) => Promise<Response> },
  refreshToken: string,
  userId?: string
) {
  const response = await auth.handler(
    request("GET", "/api/auth/token", {
      cookies: refreshCookieFor(refreshToken, userId)
    })
  )
  const body = (await response.json()) as { token?: string } | null
  if (!body?.token) throw new Error("no token for that refresh cookie")

  return body.token
}
