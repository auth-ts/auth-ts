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
    // A trailing slash used to survive the no-leading-slash branch, and every
    // request built from it carried a doubled separator.
    expect(of("api/auth/")).toBe("/api/auth")
    expect(of("/api/auth///")).toBe("/api/auth")
  })

  it("keeps a bare slash, which is a mount rather than a prefix", () => {
    expect(resolveAuthClientConfig({ basePath: "/" }).basePath).toBe("/")
  })
})
