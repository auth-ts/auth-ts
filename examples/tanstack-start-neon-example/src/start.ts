import { createMiddleware, createStart } from "@tanstack/react-start"

const ALLOWED_ORIGINS =
  process.env.NODE_ENV === "development"
    ? ["http://localhost:3001"]
    : ["https://authts.dev"]

const CORS_HEADERS = {
  "access-control-allow-credentials": "true",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age": "600"
}

const cors = createMiddleware().server(async ({ next, request }) => {
  const origin = request.headers.get("origin")
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return next()

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...CORS_HEADERS, "access-control-allow-origin": origin }
    })
  }

  const result = await next()
  result.response.headers.set("access-control-allow-origin", origin)
  result.response.headers.set("access-control-allow-credentials", "true")

  return result
})

export const startInstance = createStart(() => ({
  requestMiddleware: [cors]
}))
