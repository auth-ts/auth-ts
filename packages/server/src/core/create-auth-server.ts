import { type AuthApiError, isAuthApiError } from "../http/auth-api-error.ts"
import { AuthConfigError } from "../http/auth-config-error.ts"
import type { AuthHandler } from "../http/create-handler.ts"
import { createHandler } from "../http/create-handler.ts"
import type {
  AnyEndpoint,
  EndpointDefinition
} from "../http/define-endpoint.ts"
import { compileRoutes, matchRoute } from "../http/match-route.ts"
import { decodeToken } from "../jwt/decode-token.ts"
import type { SignTokenClaims } from "../jwt/sign-token.ts"
import { signToken } from "../jwt/sign-token.ts"
import type { TokenClaims } from "../jwt/verify-token.ts"
import { verifyToken } from "../jwt/verify-token.ts"
import type { HeadersInput } from "../session/resolve-session.ts"
import { readRefreshToken, resolveSession } from "../session/resolve-session.ts"
import type { AuthSession, AuthUser } from "./auth-db.ts"
import type { AuthServerInternals } from "./auth-server-internals.ts"
import { createAuthServerInternals } from "./auth-server-internals.ts"
import type {
  AuthServerOptions,
  ResolvedAuthServerOptions
} from "./auth-server-options.ts"
import { resolveAuthServerOptions } from "./auth-server-options.ts"
import type { EndpointRegistry } from "./endpoint-registry.ts"
import { endpointRegistry } from "./endpoint-registry.ts"

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
export type AuthHandlers = { [Name in keyof EndpointRegistry]: AuthHandler }

/** What `authServer.getSession` resolves to. */
export interface AuthSessionResult {
  session: AuthSession
  user: AuthUser
}

/** The configured server. */
export interface AuthServer extends AuthCallables {
  /** The resolved options, useful for tests and for reading back defaults. */
  options: ResolvedAuthServerOptions
  /**
   * The catch-all handler. Mount once at `<basePath>/*` and it dispatches
   * everything.
   */
  handler: AuthHandler
  /** Individual handlers, for mounting routes explicitly instead. */
  handlers: AuthHandlers
  /** Verifies a token locally — no database, no network. */
  verifyToken: (token: string) => Promise<TokenClaims | null>
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
export function createAuthServer(options: AuthServerOptions): AuthServer {
  const resolved = resolveAuthServerOptions(options)
  const internals = createAuthServerInternals(resolved)
  const routes = compileRoutes(endpointRegistry)

  const callables = {} as Record<string, (input: unknown) => Promise<unknown>>
  const handlers = {} as Record<string, AuthHandler>

  for (const [name, endpoint] of Object.entries(endpointRegistry) as Array<
    [string, AnyEndpoint]
  >) {
    callables[name] = async (input: unknown) => {
      // Called in-process rather than over HTTP, so this is where the "server-side
      // rendering never sees the cookie" trap is explained instead of silently
      // resolving to null.
      if (COOKIE_PLANE_CALLABLES.has(name)) {
        assertCookieReachable(
          resolved,
          (input as HeadersInput | undefined)?.headers,
          internals
        )
      }

      const result = await endpoint.run(internals, input as never)
      return result.data
    }
    handlers[name] = createHandler(internals, endpoint)
  }

  const handler: AuthHandler = async (request) => {
    try {
      const { endpoint } = matchRoute(internals, request, routes)
      return await createHandler(internals, endpoint)(request)
    } catch (error) {
      if (!isAuthApiError(error)) throw error
      return createHandler(internals, notFoundEndpoint(error, request))(request)
    }
  }

  return {
    ...(callables as unknown as AuthCallables),
    options: resolved,
    handler,
    handlers: handlers as AuthHandlers,
    verifyToken: async (token) => {
      const { verificationKeys } = await internals.keys()

      return verifyToken(
        {
          keys: verificationKeys,
          algorithm: resolved.jwt.alg,
          ...(resolved.issuer ? { issuer: resolved.issuer } : {}),
          ...(resolved.jwt.audience ? { audience: resolved.jwt.audience } : {})
        },
        token
      )
    },
    signToken: async (claims = {}) => {
      const { signingKey, kid } = await internals.keys()

      return signToken(
        {
          signingKey,
          algorithm: resolved.jwt.alg,
          kid,
          ttl: resolved.jwt.ttl,
          claims: resolved.jwt.claims,
          ...(resolved.issuer ? { issuer: resolved.issuer } : {}),
          ...(resolved.jwt.audience ? { audience: resolved.jwt.audience } : {})
        },
        claims
      )
    },
    decodeToken,
    getSession: async (input) => {
      assertCookieReachable(resolved, input.headers, internals)

      const resolvedSession = await resolveSession(internals, input.headers)
      return resolvedSession
        ? { session: resolvedSession.session, user: resolvedSession.user }
        : null
    }
  }
}

/**
 * Callables that read the refresh cookie and are meant for server-side use.
 *
 * Only these get the configuration guard: over HTTP a missing cookie is just an
 * unauthenticated request, but in a loader it almost always means `cookie.path`
 * is still scoped to the auth mount.
 */
const COOKIE_PLANE_CALLABLES = new Set(["getToken"])

/**
 * Turns a routing failure into an endpoint, so it flows through the usual
 * middleware. It claims the request's own method so the handler's method check
 * is a no-op here and the router's verdict — 404 or 405 — is what gets served.
 */
function notFoundEndpoint(error: AuthApiError, request: Request): AnyEndpoint {
  return {
    method: request.method,
    path: "/",
    run: async () => {
      throw error
    }
  } as AnyEndpoint
}

/**
 * Explains the "server-side rendering is always logged out" trap before it happens.
 *
 * With the default `cookie.path`, the refresh cookie is only sent to the auth
 * mount, so a page request carries nothing and this would quietly return null
 * forever. That presents as a bug in the application rather than a configuration
 * choice, so it throws with the fix in the message instead.
 */
function assertCookieReachable(
  resolved: ResolvedAuthServerOptions,
  headers: Headers | undefined,
  internals: AuthServerInternals
) {
  if (resolved.cookie.path === "/") return
  if (headers && readRefreshToken(internals, headers)) return
  if (!headers?.get("cookie")) {
    throw new AuthConfigError(
      `No auth cookie on this request, and cookie.path is "${resolved.cookie.path}" rather than "/". ` +
        'Server-side rendering only receives the refresh cookie when cookie.path is "/".'
    )
  }
}
