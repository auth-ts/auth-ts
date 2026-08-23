import type { CorsOptions } from "../core/auth-server-options"

const ALLOWED_METHODS = "GET, POST, DELETE, OPTIONS"
const ALLOWED_HEADERS = "content-type, authorization, accept-language"

/**
 * Adds CORS headers when a cross-origin client is configured.
 *
 * The origin is echoed explicitly and never `*`: these responses carry
 * credentials, and browsers refuse the wildcard together with
 * `Allow-Credentials` — correctly, since it would let any site read them.
 */
export function applyCorsHeaders(
  headers: Headers,
  cors: CorsOptions | undefined
) {
  if (!cors) return headers

  headers.set("access-control-allow-origin", cors.origin)
  headers.set("access-control-allow-credentials", "true")
  // Appended, not set: `Vary` is a list, and an endpoint that already varies
  // on something else must not have that clobbered on the way out.
  const vary = headers.get("vary")
  if (
    !vary?.split(",").some((field) => field.trim().toLowerCase() === "origin")
  ) {
    headers.append("vary", "origin")
  }

  return headers
}

/**
 * Answers a preflight request.
 *
 * Needed because the client sends JSON bodies and `DELETE`, none of
 * which are "simple" requests — without this they fail before the real request
 * is ever made.
 */
export function preflightResponse(cors: CorsOptions | undefined) {
  if (!cors) return null

  const headers = applyCorsHeaders(new Headers(), cors)
  headers.set("access-control-allow-methods", ALLOWED_METHODS)
  headers.set("access-control-allow-headers", ALLOWED_HEADERS)
  headers.set("access-control-max-age", "600")

  return new Response(null, { status: 204, headers })
}
