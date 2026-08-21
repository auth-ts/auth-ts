import type { AuthServerInternals } from "../core/auth-server-internals.ts"

/** HTTP methods the endpoint table uses. */
export type EndpointMethod = "GET" | "POST" | "PATCH" | "DELETE"

/** What an endpoint's `run` returns when it needs more than a 200 with JSON. */
export interface EndpointResult<Data> {
  data: Data
  /** Overrides the default 200, e.g. 204 for deletions. */
  status?: number
  /** Extra response headers — `Set-Cookie` from a sign-in, `Location` for a redirect. */
  headers?: Headers
}

/** What `parse` is given: the request, its dynamic segments, and the internals. */
export interface ParseContext {
  request: Request
  /**
   * Dynamic path segments, e.g. `{ provider: "github" }`.
   *
   * Resolved by matching the endpoint's own `path` against the request URL, so
   * they are identical whether the request arrived through the catch-all handler
   * or through a route the consumer mounted directly.
   */
  params: Record<string, string>
  internals: AuthServerInternals
}

/** One endpoint: the logic, plus how to reach it over HTTP. */
export interface EndpointDefinition<Input, Data> {
  method: EndpointMethod
  /**
   * Path under `basePath`, with `$param` for dynamic segments — for example
   * `/sessions/$id`. Literal paths win over dynamic ones during matching.
   */
  path: string
  /**
   * Turns a `Request` into the input `run` takes.
   *
   * Omit it for endpoints that need nothing from the request beyond headers.
   * This is the only place that touches the request body, which is what keeps
   * `run` callable in-process.
   */
  parse?: (
    request: Request,
    internals: AuthServerInternals
  ) => Promise<Input> | Input
  /**
   * The endpoint's actual work.
   *
   * Never sees a `Request` and never builds a `Response`: it takes a plain input
   * object and returns plain data, throwing {@link AuthApiError} when it cannot
   * proceed. That is what lets the same function serve an HTTP route and a direct
   * call from your own backend without one being a re-implementation of the other.
   */
  run: (
    internals: AuthServerInternals,
    input: Input
  ) => Promise<EndpointResult<Data>>
}

/**
 * Declares an endpoint.
 *
 * Identity at runtime — it exists for the types and for one authoritative place
 * to describe an endpoint. From each declaration `createAuthServer` derives three
 * things that therefore cannot drift apart: the callable on `authServer`, the
 * `Request → Response` handler, and the dispatch entry behind `authServer.handler`.
 */
export function defineEndpoint<Input, Data>(
  definition: EndpointDefinition<Input, Data>
) {
  return definition
}

/** Any endpoint, for the registry and the router. */
export type AnyEndpoint = EndpointDefinition<never, unknown>
