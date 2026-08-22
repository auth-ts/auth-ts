import { type AuthApiError, isAuthApiError } from "../http/auth-api-error"
import { AuthConfigError } from "../http/auth-config-error"
import type { AuthHandler } from "../http/create-handler"
import { createHandler, handleRequest } from "../http/create-handler"
import type { AnyEndpoint, EndpointDefinition } from "../http/define-endpoint"
import { compileRoutes, matchRoute } from "../http/match-route"
import { decodeToken } from "../jwt/decode-token"
import type { SignTokenClaims } from "../jwt/sign-token"
import { signToken } from "../jwt/sign-token"
import type { TokenClaims } from "../jwt/verify-token"
import { verifyToken } from "../jwt/verify-token"
import type { HeadersInput } from "../session/resolve-session"
import { readRefreshToken, resolveSession } from "../session/resolve-session"
import type { AdditionalFieldsSchema, AuthSession, AuthUser } from "./auth-db"
import type { AuthServerConfig } from "./auth-server-config"
import { resolveAuthServerConfig } from "./auth-server-config"
import type { AuthServerInternals } from "./auth-server-internals"
import { createAuthServerInternals } from "./auth-server-internals"
import type { AuthServerOptions } from "./auth-server-options"
import type { EndpointRegistry } from "./endpoint-registry"
import { endpointRegistry } from "./endpoint-registry"

/**
 * `T` with every user inside it carrying the declared additional fields.
 *
 * Endpoints are written once, against the erased `AuthUser`; this is what puts
 * the schema back on the way out, so `getToken()` returns `user.plan` typed
 * when `plan` was declared. Everything that is not a user passes through
 * unchanged.
 */
export type WithUserFields<
  T,
  S extends AdditionalFieldsSchema
> = T extends AuthUser
  ? AuthUser<S>
  : T extends ReadonlyArray<infer Item>
    ? WithUserFields<Item, S>[]
    : T extends Date | ((...args: never[]) => unknown)
      ? T
      : T extends object
        ? { [K in keyof T]: WithUserFields<T[K], S> }
        : T

/** The callable form of an endpoint: its input in, its data out. */
type EndpointCallable<Endpoint, S extends AdditionalFieldsSchema> =
  Endpoint extends EndpointDefinition<infer Input, infer Data>
    ? (input: Input) => Promise<WithUserFields<Data, S>>
    : never

/** Every endpoint as a directly callable function. */
export type AuthCallables<
  S extends AdditionalFieldsSchema = AdditionalFieldsSchema
> = {
  [Name in keyof EndpointRegistry]: EndpointCallable<EndpointRegistry[Name], S>
}

/** Every endpoint as an HTTP handler. */
export type AuthHandlers = { [Name in keyof EndpointRegistry]: AuthHandler }

/** What `authServer.getSession` resolves to. */
export interface AuthSessionResult<
  S extends AdditionalFieldsSchema = AdditionalFieldsSchema
> {
  session: AuthSession
  user: AuthUser<S>
}

/** The configured server. `S` is the declared additional fields; see {@link AuthServerOptions}. */
export interface AuthServer<
  S extends AdditionalFieldsSchema = AdditionalFieldsSchema
> extends AuthCallables<S> {
  /**
   * The configuration this server runs on — the options after defaults and
   * validation. Read it back in tests, or to learn a default without guessing.
   */
  config: AuthServerConfig
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
  getSession: (input: HeadersInput) => Promise<AuthSessionResult<S> | null>
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
export function createAuthServer<
  S extends AdditionalFieldsSchema = AdditionalFieldsSchema
>(options: AuthServerOptions<S>): AuthServer<S> {
  const resolved = resolveAuthServerConfig(options)
  const internals = createAuthServerInternals(resolved)
  const routes = compileRoutes(endpointRegistry)
  warnAboutInertIpLimits(internals)

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
      // The router already parsed the URL and pulled out the `$params`, so they
      // are handed straight to the endpoint rather than matched a second time.
      const { endpoint, params } = matchRoute(internals, request, routes)
      return await handleRequest(internals, endpoint, request, params)
    } catch (error) {
      if (!isAuthApiError(error)) throw error
      return handleRequest(
        internals,
        notFoundEndpoint(error, request),
        request,
        {}
      )
    }
  }

  return {
    ...(callables as unknown as AuthCallables<S>),
    config: resolved,
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
      if (!resolvedSession) return null

      // Core reads users through the erased `AuthUser`; the schema is put back
      // here, at the boundary, the same way the callables' return types are.
      return {
        session: resolvedSession.session,
        user: resolvedSession.user as AuthUser<S>
      }
    }
  }
}

/**
 * Says out loud that the per-IP limits are configured and cannot fire.
 *
 * `ipAddress.disableTracking` derives no address at all, which leaves
 * `sendCodePerIP`, `verifyCodePerIP`, and `guestPerIP` inert and
 * `session.ipAddress` null — a safe failure, and exactly the kind that is never
 * noticed until someone sprays `/send-code` across a thousand addresses. A
 * warning rather than an error, because turning tracking off on purpose is a
 * legitimate thing to do and `rateLimit` is on by default.
 *
 * The other way the limits go quiet — a deployment where no header ever carries
 * a usable address — cannot be seen from here: it takes a request to find out.
 * That one is warned about once, at the point it happens, in `ipRateLimitKey`.
 */
function warnAboutInertIpLimits(internals: AuthServerInternals) {
  const { config } = internals
  if (config.rateLimit === false || !config.ipAddress.disableTracking) return

  internals.log.warn(
    "per-IP rate limits are configured but will not apply: ipAddress.disableTracking is on, so no client address is derived. " +
      "sendCodePerIP, verifyCodePerIP, and guestPerIP are inert and session.ipAddress will be null."
  )
}

/**
 * Callables that read the refresh cookie and are meant for server-side use.
 *
 * Only these get the configuration guard: over HTTP a missing cookie is just an
 * unauthenticated request, but in a loader it almost always means `cookie.path`
 * has been narrowed to the auth mount.
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
 * Explains the "server-side rendering is always signed out" trap before it happens.
 *
 * A `cookie.path` narrowed to the auth mount means the refresh cookie is never
 * sent to a page request, so a server-side read would quietly return null
 * forever. That presents as a bug in the application rather than the cost of a
 * configuration choice, so it throws with the fix in the message instead. The
 * default path is `"/"`, so this is only ever reached by opting into scoping.
 */
function assertCookieReachable(
  resolved: AuthServerConfig,
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
