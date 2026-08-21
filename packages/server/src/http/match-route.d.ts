import type { AuthServerInternals } from "../core/auth-server-internals.ts";
import type { AnyEndpoint } from "./define-endpoint.ts";
/** A matched endpoint plus the dynamic segments pulled out of the path. */
export interface RouteMatch {
    endpoint: AnyEndpoint;
    params: Record<string, string>;
}
/** One endpoint's path split into segments once, at construction. */
interface CompiledRoute {
    endpoint: AnyEndpoint;
    segments: string[];
    /** Literal routes are tried first, so `/sign-in/guest` beats `/sign-in/$provider`. */
    isDynamic: boolean;
}
/**
 * Precompiles the endpoint registry into a matchable table.
 *
 * Built from the same registry the handlers and callables come from, so a route
 * cannot exist in one and be missing from another.
 */
export declare function compileRoutes(registry: Readonly<Record<string, AnyEndpoint>>): CompiledRoute[];
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
export declare function matchRoute(internals: AuthServerInternals, request: Request, routes: CompiledRoute[]): RouteMatch;
/**
 * Extracts one endpoint's dynamic segments from a request URL.
 *
 * Used by {@link createHandler} so a directly mounted handler resolves `$params`
 * the same way the catch-all does. Returns an empty object when the URL does not
 * line up, which leaves the endpoint to reject a missing parameter with its own
 * error rather than the router guessing.
 */
export declare function matchEndpointParams(internals: AuthServerInternals, request: Request, path: string): Record<string, string>;
export {};
//# sourceMappingURL=match-route.d.ts.map