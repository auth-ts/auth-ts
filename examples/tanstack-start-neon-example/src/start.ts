import { createMiddleware, createStart } from "@tanstack/react-start"

/**
 * Origins allowed to call this app's API from a browser.
 *
 * Only the documentation site, and only in development: its API playground
 * runs on another port, which makes every request it sends cross-origin.
 */
const ALLOWED_ORIGINS =
  process.env.NODE_ENV === "development"
    ? new Set(["http://localhost:3001"])
    : new Set<string>()

const CORS_HEADERS = {
  "access-control-allow-credentials": "true",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age": "600"
}

/**
 * Answers cross-origin requests for the whole application.
 *
 * Deliberately here rather than in `createAuthServer`: the auth mount is one
 * more route, and an API with one CORS policy should not have this corner of it
 * decided somewhere else. The auth server is told which origins to trust — that
 * is what `trustedOrigins` is — and nothing about headers.
 *
 * The origin is echoed rather than sent as `*`, which browsers refuse alongside
 * `Allow-Credentials`; without credentials the session cookie never travels and
 * `GET /token` answers null.
 */
const cors = createMiddleware().server(async ({ next, request }) => {
  const origin = request.headers.get("origin")
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return next()

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...CORS_HEADERS, "access-control-allow-origin": origin }
    })
  }

  const result = await next()
  result.response.headers.set("access-control-allow-origin", origin)
  result.response.headers.set("access-control-allow-credentials", "true")
  result.response.headers.append("vary", "origin")

  return result
})

export const startInstance = createStart(() => ({
  requestMiddleware: [cors]
}))
