import type { AuthInternals } from "../core/auth-internals"
import { AuthApiError, isAuthApiError } from "./auth-api-error"
import { assertAllowedOrigin } from "./check-origin"
import type { AnyEndpoint } from "./define-endpoint"
import { errorResponse } from "./error-response"
import { getErrorMessage } from "./get-error-message"
import { matchEndpointParams } from "./match-route"
import { resolveLocale } from "./resolve-locale"

/** A mounted endpoint: what the consumer's framework calls. */
export type AuthHandler = (request: Request) => Promise<Response>

/**
 * Turns an endpoint declaration into an HTTP handler.
 *
 * The one piece of middleware in the package, and the only place HTTP meets the
 * logic. Before: refuse a method the endpoint does not declare, and refuse a
 * state-changing request from an origin this server does not serve. After:
 * serialize a thrown {@link AuthApiError} into the standard envelope in the
 * request's locale.
 *
 * No CORS headers and no preflight: those belong to whatever already answers
 * them for the rest of the application, and an auth mount that carved its own
 * exception out of that policy would be the surprising thing.
 *
 * The method check has to live here and not only in the router: a consumer who
 * mounts `auth.handlers.getToken` on their own route may hand it any
 * method their framework lets through, and an `OPTIONS` would otherwise fall
 * straight into `parse` and `run`.
 *
 * There is no chain and no plugin system. Everything it does is unconditional or
 * driven by configuration, so reading this function tells you everything that
 * happens around every endpoint.
 */
export function createHandler(
  internals: AuthInternals,
  endpoint: AnyEndpoint
): AuthHandler {
  return (request) =>
    handleRequest(
      internals,
      endpoint,
      request,
      matchEndpointParams(internals, request, endpoint.path)
    )
}

/**
 * Serves one request with one endpoint — the body of every handler.
 *
 * Split from {@link createHandler} so the catch-all can hand over the `params`
 * its router already extracted instead of parsing the URL and matching the
 * path a second time on every request. A directly mounted handler resolves
 * them itself, through the same matcher, so the two mount styles cannot
 * disagree about what a `$param` is.
 */
export async function handleRequest(
  internals: AuthInternals,
  endpoint: AnyEndpoint,
  request: Request,
  params: Record<string, string>
): Promise<Response> {
  const { config } = internals

  const locale = resolveLocale(
    request.headers.get("accept-language"),
    config.localization
  )

  try {
    if (request.method !== endpoint.method) {
      throw new AuthApiError("methodNotAllowed", 405)
    }
    assertAllowedOrigin(internals, request)

    const input = endpoint.parse
      ? await endpoint.parse({ request, params, internals })
      : undefined
    const result = await endpoint.run(internals, input as never)

    const headers = responseHeaders(result.headers)
    const status = result.status ?? 200

    if (result.body !== undefined) {
      return new Response(result.body, { status, headers })
    }

    if (status === 204 || result.data === undefined) {
      return new Response(null, { status, headers })
    }

    headers.set("content-type", "application/json")
    return new Response(JSON.stringify(result.data), { status, headers })
  } catch (error) {
    return toErrorResponse(internals, error, locale)
  }
}

/**
 * The headers every response starts from.
 *
 * `no-store` because responses here carry tokens and per-user bodies on a
 * cookie-authenticated GET, which is exactly what a shared cache would serve to
 * the next person. An endpoint that sets its own policy — `jwks` — keeps it.
 */
function responseHeaders(init?: Headers) {
  const headers = new Headers(init)
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store")

  return headers
}

/** Serializes a failure into the standard envelope. */
function toErrorResponse(
  internals: AuthInternals,
  error: unknown,
  locale: string
) {
  const { config } = internals
  const headers = responseHeaders()

  if (isAuthApiError(error)) {
    const message = getErrorMessage(error.code, locale, config.localization, {
      ...(error.retryAfter === undefined
        ? {}
        : { retryAfter: error.retryAfter })
    })

    return errorResponse(error.code, error.status, message, {
      headers,
      ...(error.retryAfter === undefined
        ? {}
        : { retryAfter: error.retryAfter })
    })
  }

  // An unexpected throw is a bug in the consumer's own code or in this library.
  // It is logged with its message but answered with a generic body, because an
  // internal error message is exactly the kind of thing that leaks a query or a
  // connection string to whoever is poking at the endpoint.
  internals.log.error("unhandled error in auth endpoint", {
    error: String(error)
  })

  return errorResponse(
    "internalError",
    500,
    getErrorMessage("internalError", locale, config.localization),
    { headers }
  )
}
