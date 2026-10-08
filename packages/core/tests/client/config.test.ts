import { describe, expect, it } from "vitest"
import { resolveAuthClientConfig } from "../../src/client/core/auth-client-config"

describe("basePath", () => {
  it("normalizes both ends, whichever end was written oddly", () => {
    const of = (basePath?: string) =>
      resolveAuthClientConfig(basePath === undefined ? {} : { basePath })
        .basePath

    expect(of()).toBe("/api/auth")
    expect(of("/api/auth")).toBe("/api/auth")
    expect(of("api/auth")).toBe("/api/auth")
    expect(of("api/auth/")).toBe("/api/auth")
    expect(of("/api/auth///")).toBe("/api/auth")
  })

  it("keeps a bare slash, which is a mount rather than a prefix", () => {
    expect(resolveAuthClientConfig({ basePath: "/" }).basePath).toBe("/")
  })
})

describe("native origin", () => {
  const sessionStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  }
  it.each([
    undefined,
    "/auth",
    "http://example.com",
    "https://a.example/path",
    "https://a.example?key=value",
    "https://user:password@a.example"
  ])("rejects ambiguous or unsafe origin %s", (baseURL) => {
    expect(() => resolveAuthClientConfig({ sessionStorage, baseURL })).toThrow()
  })
  it.each([
    "https://example.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000"
  ])("accepts native origin %s", (baseURL) => {
    expect(resolveAuthClientConfig({ sessionStorage, baseURL }).baseURL).toBe(
      baseURL
    )
  })
})
