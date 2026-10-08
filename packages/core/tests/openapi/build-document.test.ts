import { describe, expect, it } from "vitest"
import { endpointRegistry } from "../../src/core/endpoint-registry"
import type { AnyEndpoint } from "../../src/http/define-endpoint"
import { buildOpenAPIDocument } from "../../src/openapi/build-document"
import { ERROR_CODES } from "../../src/openapi/components"
import { endpointDocs } from "../../src/openapi/endpoint-docs-registry"
import type { JsonSchema } from "../../src/openapi/json-schema"
import { createTestServer } from "../helpers/create-test-server"
import {
  readRefreshCookie,
  refreshCookieFor,
  request
} from "../helpers/request"
import { required } from "../helpers/required"

const reference = buildOpenAPIDocument()

function refs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refs)
  if (value === null || typeof value !== "object") return []

  return Object.entries(value).flatMap(([key, nested]) =>
    key === "$ref" && typeof nested === "string" ? [nested] : refs(nested)
  )
}

type DocumentedResponse = {
  headers?: Record<string, { description?: string }>
}

function responsesOf(path: string, method: string) {
  const paths = reference.paths as Record<
    string,
    Record<string, { responses: Record<string, DocumentedResponse> }>
  >

  return paths[path]?.[method]?.responses ?? {}
}

function operations(document: typeof reference) {
  return Object.values(document.paths).flatMap((item) => Object.keys(item))
}

describe("buildOpenAPIDocument", () => {
  it("describes required provider metadata as nullable", () => {
    const schemas = reference.components.schemas as Record<string, JsonSchema>
    const provider = required(schemas.ProviderToken, "provider schema")
    expect(provider.required).toEqual(["token", "expiresAt", "scope"])
    expect(provider.properties?.expiresAt).toMatchObject({
      oneOf: [{ type: "string", format: "date-time" }, { type: "null" }]
    })
    expect(provider.properties?.scope).toMatchObject({
      oneOf: [{ type: "string" }, { type: "null" }]
    })
    expect(provider.properties?.token).toEqual({ type: "string" })
  })

  it("describes nullable user properties without making them required", () => {
    const schemas = reference.components.schemas as Record<string, JsonSchema>
    const user = required(schemas.User, "user schema")
    expect(user.required).toEqual(["id", "type", "createdAt", "updatedAt"])
    for (const field of [
      "email",
      "phoneNumber",
      "name",
      "image",
      "primaryUserId"
    ]) {
      expect(user.properties?.[field]).toMatchObject({
        oneOf: [{ type: "string" }, { type: "null" }]
      })
    }
    expect(user.properties?.email).toMatchObject({
      oneOf: [{ type: "string", format: "email" }, { type: "null" }]
    })
    expect(user.properties?.type).toEqual({
      type: "string",
      enum: ["user", "guest", "admin"]
    })
    expect(user.properties?.createdAt).toEqual({
      type: "string",
      format: "date-time"
    })
  })

  it("describes every endpoint when nothing is configured away", () => {
    expect(operations(reference)).toHaveLength(
      Object.keys(endpointRegistry).length
    )
  })

  it("puts each operation at the path its endpoint declares", () => {
    for (const [name, endpoint] of Object.entries(endpointRegistry) as Array<
      [string, AnyEndpoint]
    >) {
      const path = endpoint.path.replace(/\$(\w+)/g, "{$1}")
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

  it("keeps the mount out of the paths", async () => {
    // `servers` already carries it. A path that repeats it resolves to
    // /api/auth/api/auth/session, which is what a playground actually sends.
    const { auth } = await createTestServer({ basePath: "/auth" })
    const document = buildOpenAPIDocument(auth.config)

    expect(document.servers[0]?.url.endsWith("/auth")).toBe(true)
    expect(
      Object.keys(document.paths).filter((path) => path.startsWith("/auth/"))
    ).toEqual([])
  })

  it("resolves every $ref it emits", () => {
    const schemas = reference.components.schemas as Record<string, unknown>

    for (const ref of new Set(refs(reference))) {
      expect(ref.startsWith("#/components/schemas/")).toBe(true)
      expect(schemas).toHaveProperty(ref.replace("#/components/schemas/", ""))
    }
  })

  it("publishes no schema that nothing references", () => {
    // The other direction, and the one nothing else catches: removing the last
    // operation that used a schema leaves it shipping in `/openapi.json`
    // forever, described by no route.
    const referenced = new Set(
      refs(reference).map((ref) => ref.replace("#/components/schemas/", ""))
    )
    const schemas = reference.components.schemas as Record<string, unknown>

    expect(
      Object.keys(schemas).filter((name) => !referenced.has(name))
    ).toEqual([])
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

  it("documents the origin refusals and the body cap on every state-changing operation", () => {
    const undocumented = Object.entries(reference.paths).flatMap(
      ([path, item]) =>
        Object.entries(item as Record<string, { responses: object }>)
          .filter(([method]) => !["get", "head", "options"].includes(method))
          .filter(
            ([, operation]) =>
              !("403" in operation.responses) ||
              !("413" in operation.responses) ||
              !("415" in operation.responses)
          )
          .map(([method]) => `${method.toUpperCase()} ${path}`)
    )

    expect(undocumented).toEqual([])
  })

  it("documents both the cookie and the redirect on the callback's 302", () => {
    const callback = responsesOf("/callback/{provider}", "get")["302"]

    expect(Object.keys(callback?.headers ?? {})).toEqual([
      "Set-Cookie",
      "Location"
    ])
  })

  it("names the cookie each response actually writes", () => {
    const setCookie = (path: string, method: string) =>
      Object.values(responsesOf(path, method)).find(
        (response) => response.headers?.["Set-Cookie"]
      )?.headers?.["Set-Cookie"]?.description

    expect(setCookie("/sign-in/provider/{provider}", "post")).toContain("state")
    expect(setCookie("/sign-out", "post")).toContain("Clears")
    expect(setCookie("/token", "post")).toContain("Writes `auth-ts.refresh`")
  })

  it("documents the failures each route actually answers", () => {
    expect(responsesOf("/identities/{id}/token", "get")).toHaveProperty("403")
    expect(responsesOf("/sign-in/code", "post")).toHaveProperty("401")
  })

  it("gives every operation a summary", () => {
    // A description is optional on purpose: where the summary and the schemas
    // already say it, a paraphrase reads as a second, competing answer.
    const unnamed = Object.entries(reference.paths).flatMap(([path, item]) =>
      Object.entries(item as Record<string, { summary?: string }>)
        .filter(([, operation]) => !operation.summary)
        .map(([method]) => `${method.toUpperCase()} ${path}`)
    )

    expect(unnamed).toEqual([])
  })
})

describe("buildOpenAPIDocument, given a real config", () => {
  it("drops the routes that configuration would 404", async () => {
    const { auth } = await createTestServer({
      guest: false,
      multiUser: false,
      providers: {}
    })

    const document = buildOpenAPIDocument(auth.config)
    const present = operations(document)

    expect(present.length).toBeLessThan(operations(reference).length)
    expect(document.paths).not.toHaveProperty("/sign-in/guest")
    expect(document.paths).not.toHaveProperty("/users")
    expect(document.paths).not.toHaveProperty("/identities/connect/{provider}")
    expect(document.paths).toHaveProperty("/sign-in/send-code")
  })

  it("matches actual user nulls and admin responses", async () => {
    const context = await createTestServer({
      guest: true,
      user: {
        additionalFields: { plan: "string", seats: "number", beta: "boolean" }
      }
    })
    const signedIn = await context.auth.handler(
      request("POST", "/api/auth/sign-in/guest")
    )
    const refreshToken = required(readRefreshCookie(signedIn), "refresh").value
    const { user } = (await signedIn.json()) as { user: { id: string } }
    await context.db.update({
      table: "users",
      where: { id: { eq: user.id } },
      values: { type: "admin", plan: null, seats: null, beta: null }
    })
    const response = await context.auth.handler(
      request("POST", "/api/auth/token", {
        cookies: refreshCookieFor(refreshToken)
      })
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { user: Record<string, unknown> }
    expect(body.user.type).toBe("admin")
    const document = buildOpenAPIDocument(context.auth.config)
    const schemas = document.components.schemas as Record<string, JsonSchema>
    const publishedUser = required(schemas.User, "user schema")
    expect(publishedUser.properties?.type).toMatchObject({
      enum: ["user", "guest", "admin"]
    })
    for (const field of [
      "email",
      "phoneNumber",
      "name",
      "image",
      "primaryUserId",
      "plan",
      "seats",
      "beta"
    ]) {
      expect(body.user[field]).toBeNull()
      expect(publishedUser.properties?.[field]).toMatchObject({
        oneOf: [expect.anything(), { type: "null" }]
      })
      expect(publishedUser.required).not.toContain(field)
    }
    for (const [field, type] of [
      ["plan", "string"],
      ["seats", "number"],
      ["beta", "boolean"]
    ]) {
      expect(publishedUser.properties?.[required(field, "field")]).toEqual({
        oneOf: [{ type }, { type: "null" }]
      })
    }
  })

  it("narrows {provider} to the providers actually configured", async () => {
    const { auth } = await createTestServer({
      providers: {
        github: { clientId: "a", clientSecret: "b" },
        google: { clientId: "c", clientSecret: "d" }
      }
    })

    const document = buildOpenAPIDocument(auth.config)
    const item = document.paths["/sign-in/provider/{provider}"] as
      | Record<
          string,
          { parameters: Array<{ name: string; schema: { enum?: string[] } }> }
        >
      | undefined

    expect(
      item?.post?.parameters.find(
        (parameter) => "in" in parameter && parameter.in === "path"
      )?.schema.enum
    ).toEqual(["github", "google"])
  })

  it("adds the declared additional fields to the user it describes", async () => {
    const { auth } = await createTestServer({
      user: { additionalFields: { plan: "string" } }
    })

    const document = buildOpenAPIDocument(auth.config)
    const user = document.components.schemas as Record<
      string,
      { properties: Record<string, unknown> }
    >

    expect(user.User?.properties).toHaveProperty("plan")
  })

  it("names the configured cookie in the security scheme", async () => {
    const { auth } = await createTestServer({
      cookie: { name: "session.refresh" }
    })

    const document = buildOpenAPIDocument(auth.config)
    const schemes = document.components.securitySchemes as Record<
      string,
      { name?: string }
    >

    expect(schemes.cookieAuth?.name).toBe("session.refresh")
  })
})
