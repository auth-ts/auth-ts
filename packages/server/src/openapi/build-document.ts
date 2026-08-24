import type { AuthServerConfig } from "../core/auth-server-config"
import type { EndpointRegistry } from "../core/endpoint-registry"
import { endpointRegistry } from "../core/endpoint-registry"
import type { AnyEndpoint } from "../http/define-endpoint"
import { componentResponses, componentSchemas } from "./components"
import type { AnyEndpointDocs, EndpointRequirement } from "./endpoint-docs"
import { endpointDocs, summaries } from "./endpoint-docs-registry"
import type { ComponentName, JsonSchema } from "./json-schema"

/** An OpenAPI 3.1 document, as far as this builder fills one in. */
export interface OpenAPIDocument {
  openapi: "3.1.1"
  info: { title: string; version: string; description: string }
  servers: Array<{ url: string }>
  tags: Array<{ name: string }>
  paths: Record<string, Record<string, unknown>>
  components: Record<string, unknown>
}

const TAG_ORDER = [
  "Sign in",
  "Session",
  "User",
  "Accounts",
  "Identities",
  "Discovery"
] as const

// The names Swagger's own examples use, so a reader and a client generator
// both meet what they expect.
const REFRESH_COOKIE = "cookieAuth"
const BEARER = "bearerAuth"

function met(requirement: EndpointRequirement, config: AuthServerConfig) {
  if (requirement === "guest") return config.guest
  if (requirement === "multiAccount") return config.multiAccount
  if (requirement === "providers")
    return Object.keys(config.providers).length > 0
  if (requirement === "jwks") return config.jwks?.json !== undefined
  return config.baseURL !== undefined
}

function expand(schema: JsonSchema | ComponentName): JsonSchema {
  if (typeof schema === "string")
    return { $ref: `#/components/schemas/${schema}` }
  if (!schema.properties && !schema.items) return schema

  const properties =
    schema.properties &&
    Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [
        key,
        expand(value)
      ])
    )

  return {
    ...schema,
    ...(properties ? { properties } : {}),
    ...(schema.items ? { items: expand(schema.items) } : {})
  }
}

function pathParameters(
  path: string,
  docs: AnyEndpointDocs,
  providers?: string[]
) {
  return path
    .split("/")
    .filter((segment) => segment.startsWith("$"))
    .map((segment) => segment.slice(1))
    .map((name) => ({
      name,
      in: "path",
      required: true,
      description: docs.params?.[name],
      schema:
        name === "provider" && providers?.length
          ? { type: "string", enum: providers }
          : { type: "string" }
    }))
}

function userSchema(config?: AuthServerConfig) {
  const declared = Object.entries(config?.user.additionalFields ?? {})
  if (declared.length === 0) return componentSchemas.User

  const base = componentSchemas.User
  return {
    ...base,
    properties: {
      ...base.properties,
      ...Object.fromEntries(
        declared.map(([field, kind]) => [field, { type: kind }])
      )
    }
  }
}

function operation(
  name: keyof EndpointRegistry,
  endpoint: AnyEndpoint,
  docs: AnyEndpointDocs,
  config?: AuthServerConfig
) {
  const responses: Record<string, unknown> = {}
  for (const [status, response] of Object.entries(docs.responses)) {
    if (response === undefined) continue
    if (typeof response === "string") {
      responses[status] = componentResponses[response]
      continue
    }

    const content = response.redirect
      ? undefined
      : response.contentType === "text/html"
        ? { "text/html": { schema: { type: "string" } } }
        : response.schema
          ? { "application/json": { schema: expand(response.schema) } }
          : undefined

    responses[status] = {
      description: response.description,
      ...(content ? { content } : {}),
      ...(response.setsCookie
        ? {
            headers: {
              "Set-Cookie": {
                schema: { type: "string" },
                description: `Writes \`${config?.cookie.name ?? "auth-ts.refresh"}\`, HttpOnly and SameSite=Lax.`
              }
            }
          }
        : {}),
      ...(response.redirect
        ? {
            headers: { Location: { schema: { type: "string", format: "uri" } } }
          }
        : {})
    }
  }

  responses["405"] = componentResponses.MethodNotAllowed
  responses["500"] = componentResponses.InternalError

  const security =
    docs.auth === "none"
      ? []
      : docs.auth === "cookie"
        ? [{ [REFRESH_COOKIE]: [] }]
        : [{ [BEARER]: [] }]

  const body = docs.body && {
    required: true,
    content: { "application/json": { schema: expand(docs.body) } }
  }

  const parameters = [
    ...pathParameters(
      endpoint.path,
      docs,
      config && Object.keys(config.providers)
    ),
    ...Object.entries(docs.query ?? {}).map(([name, schema]) => ({
      name,
      in: "query",
      schema
    }))
  ]

  return {
    operationId: name,
    summary: summaries[name],
    description: docs.description,
    tags: [docs.tag],
    security,
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(body ? { requestBody: body } : {}),
    responses
  }
}

/**
 * Builds the OpenAPI document for this server.
 *
 * Called without a config it describes the library rather than a deployment:
 * every feature on, every provider offered, a relative `servers` entry. That is
 * what the documentation site renders, and it is why building the document needs
 * neither a database nor a signing key. Given a real config it drops the routes
 * that configuration would 404, narrows `{provider}` to the ones wired up, and
 * adds the declared additional fields to every user it describes.
 */
export function buildOpenAPIDocument(
  config?: AuthServerConfig
): OpenAPIDocument {
  const basePath = config?.basePath ?? "/api/auth"
  const paths: Record<string, Record<string, unknown>> = {}

  for (const [name, endpoint] of Object.entries(endpointRegistry) as Array<
    [keyof EndpointRegistry, AnyEndpoint]
  >) {
    const docs = endpointDocs[name]
    if (docs.requires && config && !met(docs.requires, config)) continue

    // Relative to the server, which already carries the mount. Repeating it
    // here would make every resolved URL double it.
    const path = endpoint.path.replace(/\$(\w+)/g, "{$1}")
    paths[path] ??= {}
    paths[path][endpoint.method.toLowerCase()] = operation(
      name,
      endpoint,
      docs,
      config
    )
  }

  return {
    openapi: "3.1.1",
    info: {
      title: "Auth.ts",
      version: "0.1.0",
      description:
        "Sign-in responses set an HttpOnly refresh cookie that `GET /token` reads; it never appears in a body. `GET /callback/{provider}` answers a top-level navigation with a redirect, so it is not something to fetch."
    },
    servers: [{ url: (config?.baseURL ?? "") + basePath }],
    tags: TAG_ORDER.map((name) => ({ name })),
    paths,
    components: {
      schemas: {
        ...Object.fromEntries(
          Object.entries(componentSchemas).map(([name, schema]) => [
            name,
            expand(schema)
          ])
        ),
        User: expand(userSchema(config))
      },
      responses: componentResponses,
      securitySchemes: {
        [BEARER]: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "An access token from `GET /token`."
        },
        [REFRESH_COOKIE]: {
          type: "apiKey",
          in: "cookie",
          name: config?.cookie.name ?? "auth-ts.refresh",
          description:
            "Set by the server, HttpOnly and host-only. A browser sends it automatically; a playground cannot set it."
        }
      }
    }
  }
}
