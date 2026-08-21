import type { AuthServerInternals } from "../core/auth-server-internals.ts";
import type { AnyEndpoint } from "./define-endpoint.ts";
/** A mounted endpoint: what the consumer's framework calls. */
export type AuthHandler = (request: Request) => Promise<Response>;
/**
 * Turns an endpoint declaration into an HTTP handler.
 *
 * The one piece of middleware in the package, and the only place HTTP meets the
 * logic. Before: answer a CORS preflight. After: attach CORS headers, serialize a
 * thrown {@link AuthApiError} into the standard envelope in the request's locale,
 * and sweep expired rows fire-and-forget.
 *
 * There is no chain and no plugin system. Everything it does is unconditional or
 * driven by configuration, so reading this function tells you everything that
 * happens around every endpoint.
 */
export declare function createHandler(internals: AuthServerInternals, endpoint: AnyEndpoint): AuthHandler;
/** Mounts every endpoint in a registry, keyed by name. */
export declare function createHandlers<Registry extends Record<string, AnyEndpoint>>(internals: AuthServerInternals, registry: Registry): Record<keyof Registry, AuthHandler>;
//# sourceMappingURL=create-handler.d.ts.map