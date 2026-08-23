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

/** Exchanges a refresh cookie for an access token, the way a client boots. */
export async function mintToken(
  authServer: { handler: (request: Request) => Promise<Response> },
  refreshToken: string
) {
  const response = await authServer.handler(
    request("GET", "/api/auth/token", {
      cookies: { "auth-ts.refresh": refreshToken }
    })
  )
  const body = (await response.json()) as { token?: string } | null
  if (!body?.token) throw new Error("no token for that refresh cookie")

  return body.token
}
