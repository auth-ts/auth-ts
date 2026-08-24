import { describe, expect, it } from "vitest"
import { endpointRegistry } from "../../src/core/endpoint-registry"
import type { AnyEndpoint } from "../../src/http/define-endpoint"
import { buildOpenAPIDocument } from "../../src/openapi/build-document"
import { ERROR_CODES } from "../../src/openapi/components"
import { endpointDocs } from "../../src/openapi/endpoint-docs-registry"
import { createTestServer } from "../helpers/create-test-server"

const reference = buildOpenAPIDocument()

function refs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refs)
  if (value === null || typeof value !== "object") return []

  return Object.entries(value).flatMap(([key, nested]) =>
    key === "$ref" && typeof nested === "string" ? [nested] : refs(nested)
  )
}

function operations(document: typeof reference) {
  return Object.values(document.paths).flatMap((item) => Object.keys(item))
}

describe("buildOpenAPIDocument", () => {
  it("describes every endpoint when nothing is configured away", () => {
    expect(operations(reference)).toHaveLength(
      Object.keys(endpointRegistry).length
    )
  })

  it("puts each operation at the path its endpoint declares", () => {
    for (const [name, endpoint] of Object.entries(endpointRegistry) as Array<
      [string, AnyEndpoint]
    >) {
      const path = `/api/auth${endpoint.path.replace(/\$(\w+)/g, "{$1}")}`
      const item = reference.paths[path] as Record<
        string,
        { operationId: string }
      >

      expect(item?.[endpoint.method.toLowerCase()]?.operationId).toBe(name)
    }
  })

  it("documents exactly the path parameters each route has", () => {
    for (const [name, endpoint] of Object.entries(endpointRegistry) as Array<
      [string, AnyEndpoint]
    >) {
      const declared = endpoint.path
        .split("/")
        .filter((segment) => segment.startsWith("$"))
        .map((segment) => segment.slice(1))

      const documented = Object.keys(
        endpointDocs[name as keyof typeof endpointDocs].params ?? {}
      )

      expect(documented.sort()).toEqual(declared.sort())
    }
  })

  it("resolves every $ref it emits", () => {
    const schemas = reference.components.schemas as Record<string, unknown>

    for (const ref of new Set(refs(reference))) {
      expect(ref.startsWith("#/components/schemas/")).toBe(true)
      expect(schemas).toHaveProperty(ref.replace("#/components/schemas/", ""))
    }
  })

  it("survives the JSON round trip it is served through", () => {
    expect(JSON.parse(JSON.stringify(reference))).toEqual(reference)
  })

  it("enumerates the error codes on the shared envelope", () => {
    const schemas = reference.components.schemas as Record<
      string,
      { properties: Record<string, { enum?: readonly string[] }> }
    >

    expect(schemas.AuthError?.properties.code?.enum).toEqual(ERROR_CODES)
  })

  it("gives every operation a summary and a description", () => {
    const thin = Object.entries(reference.paths).flatMap(([path, item]) =>
      Object.entries(
        item as Record<string, { summary?: string; description?: string }>
      )
        .filter(([, operation]) => !operation.summary || !operation.description)
        .map(([method]) => `${method.toUpperCase()} ${path}`)
    )

    expect(thin).toEqual([])
  })
})

describe("buildOpenAPIDocument, given a real config", () => {
  it("drops the routes that configuration would 404", async () => {
    const { authServer } = await createTestServer({
      guest: false,
      multiAccount: false,
      providers: {}
    })

    const document = buildOpenAPIDocument(authServer.config)
    const present = operations(document)

    expect(present.length).toBeLessThan(operations(reference).length)
    expect(document.paths).not.toHaveProperty("/api/auth/sign-in/guest")
    expect(document.paths).not.toHaveProperty("/api/auth/accounts")
    expect(document.paths).not.toHaveProperty("/api/auth/connect/{provider}")
    expect(document.paths).toHaveProperty("/api/auth/send-code")
  })

  it("narrows {provider} to the providers actually configured", async () => {
    const { authServer } = await createTestServer({
      providers: {
        github: { clientId: "a", clientSecret: "b" },
        google: { clientId: "c", clientSecret: "d" }
      }
    })

    const document = buildOpenAPIDocument(authServer.config)
    const item = document.paths["/api/auth/sign-in/provider/{provider}"] as
      | Record<
          string,
          { parameters: Array<{ name: string; schema: { enum?: string[] } }> }
        >
      | undefined

    expect(item?.post?.parameters[0]?.schema.enum).toEqual(["github", "google"])
  })

  it("adds the declared additional fields to the user it describes", async () => {
    const { authServer } = await createTestServer({
      user: { additionalFields: { plan: "string" } }
    })

    const document = buildOpenAPIDocument(authServer.config)
    const user = document.components.schemas as Record<
      string,
      { properties: Record<string, unknown> }
    >

    expect(user.User?.properties).toHaveProperty("plan")
  })

  it("names the configured cookie in the security scheme", async () => {
    const { authServer } = await createTestServer({
      cookie: { name: "session.refresh" }
    })

    const document = buildOpenAPIDocument(authServer.config)
    const schemes = document.components.securitySchemes as Record<
      string,
      { name?: string }
    >

    expect(schemes.refreshCookie?.name).toBe("session.refresh")
  })
})
