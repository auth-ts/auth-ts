import type { AuthServerInternals } from "../core/auth-server-internals.ts"
import { applyCorsHeaders, preflightResponse } from "./apply-cors.ts"
import { AuthApiError, isAuthApiError } from "./auth-api-error.ts"
import type { AnyEndpoint } from "./define-endpoint.ts"
import { errorResponse } from "./error-response.ts"
import { getErrorMessage } from "./get-error-message.ts"
import { matchEndpointParams } from "./match-route.ts"
import { resolveLocale } from "./resolve-locale.ts"

/** A mounted endpoint: what the consumer's framework calls. */
export type AuthHandler = (request: Request) => Promise<Response>

/**
 * Turns an endpoint declaration into an HTTP handler.
 *
 * The one piece of middleware in the package, and the only place HTTP meets the
 * logic. Before: answer a CORS preflight, and refuse a method the endpoint does
 * not declare. After: attach CORS headers, serialize a thrown
 * {@link AuthApiError} into the standard envelope in the request's locale, and
 * sweep expired rows fire-and-forget.
 *
 * The method check has to live here and not only in the router: a consumer who
 * mounts `authServer.handlers.getToken` on their own route may hand it any method
 * their framework lets through, and without CORS configured an `OPTIONS` would
 * otherwise fall straight into `parse` and `run`.
 *
 * There is no chain and no plugin system. Everything it does is unconditional or
 * driven by configuration, so reading this function tells you everything that
 * happens around every endpoint.
 */
export function createHandler(
  internals: AuthServerInternals,
  endpoint: AnyEndpoint
): AuthHandler {
  return async (request) => {
    const { options } = internals

    if (request.method === "OPTIONS") {
      const preflight = preflightResponse(options.cors)
      if (preflight) return preflight
    }

    const locale = resolveLocale(
      request.headers.get("accept-language"),
      options.localization
    )

    try {
      if (request.method !== endpoint.method) {
        throw new AuthApiError("methodNotAllowed", 405)
      }

      const params = matchEndpointParams(internals, request, endpoint.path)
      const input = endpoint.parse
        ? await endpoint.parse({ request, params, internals })
        : undefined
      const result = await endpoint.run(internals, input as never)

      const headers = applyCorsHeaders(
        new Headers(result.headers),
        options.cors
      )
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
    } finally {
      sweepExpired(internals)
    }
  }
}

/** Serializes a failure into the standard envelope. */
function toErrorResponse(
  internals: AuthServerInternals,
  error: unknown,
  locale: string
) {
  const { options } = internals
  const headers = applyCorsHeaders(new Headers(), options.cors)

  if (isAuthApiError(error)) {
    const message = getErrorMessage(error.code, locale, options.localization, {
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

  // An unexpected throw is a bug in the consumer's callbacks or in this library.
  // It is logged with its message but answered with a generic body, because an
  // internal error message is exactly the kind of thing that leaks a query or a
  // connection string to whoever is poking at the endpoint.
  internals.log.error("unhandled error in auth endpoint", {
    error: String(error)
  })

  headers.set("content-type", "application/json")

  return new Response(
    JSON.stringify({
      error: { code: "internalError", message: "Something went wrong." }
    }),
    { status: 500, headers }
  )
}

/**
 * Deletes expired rows without making the caller wait.
 *
 * Runs after every request that reaches an endpoint, reads included — a CORS
 * preflight is the only thing that returns before the sweep. Reads are not an
 * oversight: rows expire on a clock rather than on writes, so a read-heavy
 * deployment is exactly the one that would otherwise never clean up.
 *
 * Sweeping that often sounds wasteful and is the opposite: frequent sweeps each
 * delete almost nothing, and an indexed delete-where-expired on a nearly clean
 * table costs microseconds — far less than the bookkeeping needed to run it less
 * often. Failures go to the log rather than vanishing into an empty catch, and
 * never affect the response.
 */
function sweepExpired(internals: AuthServerInternals) {
  if (!internals.options.cleanup) return

  void Promise.resolve(internals.db.deleteExpired()).catch((error: unknown) => {
    internals.log.error("deleteExpired failed", { error: String(error) })
  })
}

/** Mounts every endpoint in a registry, keyed by name. */
export function createHandlers<Registry extends Record<string, AnyEndpoint>>(
  internals: AuthServerInternals,
  registry: Registry
) {
  const handlers = {} as Record<keyof Registry, AuthHandler>

  for (const [name, endpoint] of Object.entries(registry) as Array<
    [keyof Registry, AnyEndpoint]
  >) {
    handlers[name] = createHandler(internals, endpoint)
  }

  return handlers
}
