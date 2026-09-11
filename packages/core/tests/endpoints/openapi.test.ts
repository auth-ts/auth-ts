import { describe, expect, it, vi } from "vitest"
import { buildOpenAPIDocument } from "../../src/openapi/build-document"
import { createTestServer } from "../helpers/create-test-server"
import { request } from "../helpers/request"

vi.mock("../../src/openapi/build-document", { spy: true })

describe("the OpenAPI endpoints", () => {
  it("404s both routes unless openapi is enabled", async () => {
    // Publishing providers and fields is opt-in.
    const { auth } = await createTestServer()

    for (const path of ["/api/auth/openapi.json", "/api/auth/reference"]) {
      const response = await auth.handler(request("GET", path))
      expect(response.status, path).toBe(404)
    }
  })

  it("serves the document and the reference page when enabled", async () => {
    const { auth } = await createTestServer({ openapi: true })

    const document = await auth.handler(
      request("GET", "/api/auth/openapi.json")
    )
    expect(document.status).toBe(200)
    expect(((await document.json()) as { openapi?: string }).openapi).toMatch(
      /^3\./
    )

    const reference = await auth.handler(request("GET", "/api/auth/reference"))
    expect(reference.status).toBe(200)
    expect(reference.headers.get("content-type")).toContain("text/html")
  })

  it("builds the document once per server, not per request", async () => {
    vi.mocked(buildOpenAPIDocument).mockClear()
    const first = await createTestServer({ openapi: true })
    const second = await createTestServer({ openapi: true })

    for (const context of [first, second]) {
      for (let hit = 0; hit < 2; hit++) {
        const response = await context.auth.handler(
          request("GET", "/api/auth/openapi.json")
        )
        expect(response.status).toBe(200)
      }
    }

    expect(vi.mocked(buildOpenAPIDocument)).toHaveBeenCalledTimes(2)
  })
})
