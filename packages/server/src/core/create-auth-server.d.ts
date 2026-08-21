import type { AuthHandler } from "../http/create-handler.ts"
import type { EndpointDefinition } from "../http/define-endpoint.ts"
import { decodeToken } from "../jwt/decode-token.ts"
import type { SignTokenClaims } from "../jwt/sign-token.ts"
import type { HeadersInput } from "../session/resolve-session.ts"
import type { AuthServerOptions } from "./auth-server-options.ts"
import type { EndpointRegistry } from "./endpoint-registry.ts"

/** The callable form of an endpoint: its input in, its data out. */
type EndpointCallable<Endpoint> =
  Endpoint extends EndpointDefinition<infer Input, infer Data>
    ? (input: Input) => Promise<Data>
    : never
/** Every endpoint as a directly callable function. */
export type AuthCallables = {
  [Name in keyof EndpointRegistry]: EndpointCallable<EndpointRegistry[Name]>
}
/** Every endpoint as an HTTP handler. */
export type AuthHandlers = {
  [Name in keyof EndpointRegistry]: AuthHandler
}
/** What `authServer.getSession` resolves to. */
export interface AuthSessionResult {
  session: import("./auth-db.ts").AuthSession
  user: import("./auth-db.ts").AuthUser
}
/** The configured server. */
export interface AuthServer extends AuthCallables {
  /** The resolved options, useful for tests and for reading back defaults. */
  options: import("./auth-server-options.ts").ResolvedAuthServerOptions
  /**
   * The catch-all handler. Mount once at `<basePath>/*` and it dispatches
   * everything.
   */
  handler: AuthHandler
  /** Individual handlers, for mounting routes explicitly instead. */
  handlers: AuthHandlers
  /** Verifies a token locally — no database, no network. */
  verifyToken: (
    token: string
  ) => Promise<import("../jwt/verify-token.ts").TokenClaims | null>
  /** Signs an arbitrary payload. The private key with a function signature. */
  signToken: (claims?: SignTokenClaims) => Promise<string>
  /** Decodes without verifying. Never authorize with this. */
  decodeToken: typeof decodeToken
  /** Resolves the refresh cookie to a session and user. One database round-trip. */
  getSession: (input: HeadersInput) => Promise<AuthSessionResult | null>
}
/**
 * Creates the auth server.
 *
 * Synchronous and free of input/output: every default is applied and every
 * misconfiguration is thrown here rather than on the first request, and the
 * signing key is imported lazily. That makes it cheap to memoize one instance per
 * tenant and dispatch to it from your own routing.
 *
 * The returned object exposes the same endpoints three ways — as callables, as
 * individual handlers, and behind one catch-all handler — all derived from a
 * single registry, so they cannot disagree about what exists or what it does.
 *
 * @throws {AuthConfigError} When the configuration is incomplete or contradictory.
 */
export declare function createAuthServer(options: AuthServerOptions): AuthServer
//# sourceMappingURL=create-auth-server.d.ts.map
