import type { AuthInternals } from "../core/auth-internals"
import { AuthApiError } from "./auth-api-error"
import type { AnyEndpoint } from "./define-endpoint"
import { splitPathSegments } from "./get-route-param"

/** A matched endpoint plus the dynamic segments pulled out of the path. */
export interface RouteMatch {
  endpoint: AnyEndpoint
  params: Record<string, string>
}

/** One endpoint's path split into segments once, at construction. */
interface CompiledRoute {
  endpoint: AnyEndpoint
  segments: string[]
  /** Literal routes are tried first, so `/identities//token` beats `/identities/`. */
  isDynamic: boolean
}

/**
 * Precompiles the endpoint registry into a matchable table.
 *
 * Built from the same registry the handlers and callables come from, so a route
 * cannot exist in one and be missing from another.
 */
export function compileRoutes(registry: Readonly<Record<string, AnyEndpoint>>) {
  return Object.values(registry)
    .map<CompiledRoute>((endpoint) => {
      const segments = endpoint.path
        .split("/")
        .filter((segment) => segment.length > 0)
      return {
        endpoint,
        segments,
        isDynamic: segments.some((segment) => segment.startsWith("$"))
      }
    })
    .sort((left, right) => Number(left.isDynamic) - Number(right.isDynamic))
}

/**
 * Finds the endpoint for a request within the mount.
 *
 * Deliberately not a router package: this is roughly twenty fixed paths and four
 * single-segment dynamic ones, and the consumer's own framework has already
 * routed the request here. What a router would buy us is correctness on trailing
 * slashes, percent-encoding, and precedence — each of which is handled here and
 * covered by a named test.
 *
 * @throws {AuthApiError} `notFound` when nothing matches the path, or
 * `methodNotAllowed` when the path exists but the method does not.
 */
export function matchRoute(
  internals: AuthInternals,
  request: Request,
  routes: CompiledRoute[]
): RouteMatch {
  const { pathname } = new URL(request.url)
  const requestSegments = splitPathSegments(pathname, internals.config.basePath)
  if (!requestSegments) throw new AuthApiError("notFound", 404)

  let pathMatchedWithOtherMethod = false

  for (const route of routes) {
    const params = matchSegments(route.segments, requestSegments)
    if (!params) continue

    if (route.endpoint.method !== request.method) {
      pathMatchedWithOtherMethod = true
      continue
    }

    return { endpoint: route.endpoint, params }
  }

  throw new AuthApiError(
    pathMatchedWithOtherMethod ? "methodNotAllowed" : "notFound",
    pathMatchedWithOtherMethod ? 405 : 404
  )
}

/** Compares one route's segments against a request's, collecting `$params`. */
function matchSegments(routeSegments: string[], requestSegments: string[]) {
  if (routeSegments.length !== requestSegments.length) return null

  const params: Record<string, string> = {}

  for (const [index, routeSegment] of routeSegments.entries()) {
    const requestSegment = requestSegments[index]
    if (requestSegment === undefined) return null

    if (routeSegment.startsWith("$")) {
      params[routeSegment.slice(1)] = requestSegment
      continue
    }

    if (routeSegment !== requestSegment) return null
  }

  return params
}

/**
 * Extracts one endpoint's dynamic segments from a request URL.
 *
 * Used by {@link createHandler} so a directly mounted handler resolves `$params`
 * the same way the catch-all does. Returns an empty object when the URL does not
 * line up, which leaves the endpoint to reject a missing parameter with its own
 * error rather than the router guessing.
 */
export function matchEndpointParams(
  internals: AuthInternals,
  request: Request,
  path: string
) {
  const { pathname } = new URL(request.url)
  const requestSegments = splitPathSegments(pathname, internals.config.basePath)
  if (!requestSegments) return {}

  const routeSegments = path.split("/").filter((segment) => segment.length > 0)

  return matchSegments(routeSegments, requestSegments) ?? {}
}
