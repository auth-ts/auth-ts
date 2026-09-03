import type {
  ComponentName,
  ComponentResponseName,
  DeclaredFields,
  JsonSchema,
  ObjectSchemaFor
} from "./json-schema"

/** The groups operations are filed under, in the order a reader should meet them. */
export type EndpointTag =
  | "Sign in"
  | "Session"
  | "User"
  | "Users"
  | "Identities"
  | "Discovery"

/** Which credential an operation reads. `"none"` is published, not left blank. */
export type EndpointAuth = "bearer" | "cookie" | "none"

/**
 * Configuration an operation depends on.
 *
 * A deployment without it answers 404 on that route, so the document leaves the
 * route out rather than describing something the reader cannot call.
 */
export type EndpointRequirement =
  | "guest"
  | "multiUser"
  | "providers"
  | "jwks"
  | "baseURL"

/** One documented response. */
export interface EndpointResponse {
  description: string
  schema?: JsonSchema | ComponentName
  /** Which cookie the response writes; the builder names it from `config.cookie`. */
  setsCookie?: "refresh" | "accounts" | "state" | "cleared"
  /** A `Location` header and no body. */
  redirect?: true
  /** Only the OAuth callback, which answers a navigation with a page. */
  contentType?: "text/html"
}

/**
 * How one endpoint appears in the OpenAPI document.
 *
 * Method, path, and the names of the path parameters are absent on purpose: the
 * builder reads them off the endpoint itself, so they cannot disagree. The
 * summary is absent for a different reason — it is the first line of the
 * endpoint's own doc comment, kept in `summaries` and checked against it.
 */
export interface EndpointDocs<
  Input,
  PathParam extends keyof Input & string = never
> {
  /**
   * What an HTTP caller needs that the summary and the schemas do not already
   * say. Omitted when there is nothing — a paraphrase of the endpoint's own doc
   * comment is worse than one line, because it reads as a second answer.
   */
  description?: string
  tag: EndpointTag
  auth: EndpointAuth
  requires?: EndpointRequirement
  /** Prose for the `$` segments of `path`. The names come from the path. */
  params?: { [K in PathParam]: string }
  query?: Record<string, JsonSchema>
  /** Where the consumer's declared `user.additionalFields` land in the body. */
  additionalFields?: "nested" | "flat"
  // Stripped before the omit, not after: `Omit` collapses an index signature
  // over the declared keys and would leave nothing to enforce.
  body?: ObjectSchemaFor<
    Omit<
      DeclaredFields<Input>,
      PathParam | "headers" | "token" | "requestURL" | "additionalFields"
    >
  >
  /** Sparse: the builder adds 405 and 500 to every operation on its own. */
  responses: Partial<Record<number, EndpointResponse | ComponentResponseName>>
}

/**
 * Any endpoint's docs, for the table that pairs them with the registry.
 *
 * Written out rather than `EndpointDocs<never>` for the same variance reason
 * {@link AnyEndpoint} exists: `params` and `body` are keyed off `Input`, so no
 * single type argument makes every concrete `EndpointDocs` assignable.
 */
export interface AnyEndpointDocs {
  description?: string
  tag: EndpointTag
  auth: EndpointAuth
  requires?: EndpointRequirement
  params?: Record<string, string>
  query?: Record<string, JsonSchema>
  additionalFields?: "nested" | "flat"
  body?: JsonSchema
  responses: Partial<Record<number, EndpointResponse | ComponentResponseName>>
}
