import { describe, expect, it } from "vitest"
import { createTestServer } from "../helpers/create-test-server"
import { request } from "../helpers/request"

describe("matchRoute", () => {
  it("dispatches every documented endpoint through the catch-all", async () => {
    const { authServer } = await createTestServer({
      guest: true,
      jwks: { json: { keys: [] } }
    })

    // Unauthenticated is fine here — what matters is that none of these 404.
    const probes: Array<[string, string]> = [
      ["POST", "/api/auth/send-code"],
      ["GET", "/api/auth/token"],
      ["POST", "/api/auth/sign-in/code"],
      ["POST", "/api/auth/user"],
      ["POST", "/api/auth/sign-out"],
      ["GET", "/api/auth/user"],
      ["POST", "/api/auth/user"],
      ["DELETE", "/api/auth/user"],
      ["GET", "/api/auth/sessions"],
      ["DELETE", "/api/auth/sessions/abc"],
      ["POST", "/api/auth/sign-in/guest"],
      ["GET", "/api/auth/identities"],
      ["GET", "/api/auth/jwks"]
    ]

    for (const [method, path] of probes) {
      const response = await authServer.handler(request(method, path))
      expect([method, path, response.status]).not.toEqual([method, path, 404])
    }
  })

  it("tolerates a trailing slash", async () => {
    const { authServer } = await createTestServer({
      jwks: { json: { keys: [] } }
    })
    expect(
      (await authServer.handler(request("GET", "/api/auth/jwks/"))).status
    ).toBe(200)
  })

  it("answers 405 for a known path with the wrong method, not 404", async () => {
    const { authServer } = await createTestServer()
    const response = await authServer.handler(
      request("GET", "/api/auth/send-code")
    )

    expect(response.status).toBe(405)
    expect(((await response.json()) as { code: string }).code).toBe(
      "methodNotAllowed"
    )
  })

  it("refuses the wrong method on a directly mounted handler before parsing", async () => {
    // The router is not in front of `authServer.handlers.*`, so the handler has
    // to enforce its own method. Without this a GET fell into `parse` and `run`.
    const { authServer } = await createTestServer()
    const response = await authServer.handlers.sendCode(
      request("GET", "/api/auth/send-code")
    )

    expect(response.status).toBe(405)
    expect(((await response.json()) as { code: string }).code).toBe(
      "methodNotAllowed"
    )
  })

  it("keeps the router's 404 for an unknown path, whatever the method", async () => {
    // Regression guard for the handler's method check: the fallback endpoint
    // behind the catch-all must not turn a routing 404 into a 405.
    const { authServer } = await createTestServer()
    for (const method of ["GET", "POST", "DELETE"]) {
      const response = await authServer.handler(
        request(method, "/api/auth/nope")
      )
      expect(response.status, method).toBe(404)
    }
  })

  it("404s an unknown path inside the mount and anything outside it", async () => {
    const { authServer } = await createTestServer()

    expect(
      (await authServer.handler(request("GET", "/api/auth/nope"))).status
    ).toBe(404)
    expect(
      (await authServer.handler(request("GET", "/somewhere-else"))).status
    ).toBe(404)
  })

  it("keeps a provider name from ever shadowing a literal sign-in route", async () => {
    // Providers sit one level down, under /sign-in/provider/:provider, so a
    // provider called `guest` or `code` reaches its own path and the literal
    // routes keep theirs. That is what replaced the reserved-names list: a
    // collision that cannot be expressed rather than one that is forbidden.
    const { authServer } = await createTestServer({
      guest: true,
      baseURL: "https://app.example.com",
      providers: { github: { clientId: "id", clientSecret: "secret" } }
    })

    expect(
      (await authServer.handler(request("POST", "/api/auth/sign-in/guest")))
        .status
    ).toBe(200)
    // The literal path answers only its own method; nothing dynamic is mounted
    // beside it to pick the request up.
    expect(
      (await authServer.handler(request("GET", "/api/auth/sign-in/guest")))
        .status
    ).toBe(405)
    expect(
      (
        await authServer.handler(
          request("POST", "/api/auth/sign-in/provider/github")
        )
      ).status
    ).toBe(200)
  })

  it("keeps a percent-encoded slash inside one segment", async () => {
    const { authServer } = await createTestServer()

    // %2F must not split into two segments, or an id could smuggle a path.
    const response = await authServer.handler(
      request("DELETE", "/api/auth/sessions/abc%2Fdef")
    )
    expect(response.status).toBe(401)
  })

  it("answers 404 for malformed percent-encoding instead of throwing or 500ing", async () => {
    // decodeURIComponent throws URIError on these. Before the guard, the
    // catch-all re-threw it out of authServer.handler entirely, and a directly
    // mounted handler turned it into a 500.
    const { authServer } = await createTestServer()

    for (const path of [
      "/api/auth/%zz",
      "/api/auth/sessions/%",
      "/api/auth/%E0%A4%A"
    ]) {
      const viaCatchAll = await authServer.handler(request("GET", path))
      expect(viaCatchAll.status, `catch-all ${path}`).toBe(404)

      const viaRoute = await authServer.handlers.revokeSession(
        request("DELETE", path)
      )
      expect(viaRoute.status, `per-route ${path}`).toBeLessThan(500)
    }
  })

  it("honours a custom basePath, including one written with a trailing slash", async () => {
    const { authServer } = await createTestServer({
      basePath: "/auth/",
      jwks: { json: { keys: [] } }
    })

    expect(authServer.config.basePath).toBe("/auth")
    expect(
      (await authServer.handler(request("GET", "/auth/jwks"))).status
    ).toBe(200)
    expect(
      (await authServer.handler(request("GET", "/api/auth/jwks"))).status
    ).toBe(404)
  })
})

describe("origin check", () => {
  // CORS headers decide who may read a response, not who may send a request.
  // A simple POST carries the cookie without a preflight, so state-changing
  // requests are refused unless their Origin is one this server serves.
  it("refuses a state-changing request from an origin it does not serve", async () => {
    const { authServer } = await createTestServer({
      guest: true,
      jwks: { json: { keys: [] } }
    })

    const refused = await authServer.handler(
      request("POST", "/api/auth/sign-in/guest", {
        headers: { origin: "https://evil.example.com" }
      })
    )
    expect(refused.status).toBe(403)
    expect(((await refused.json()) as { code: string }).code).toBe(
      "forbiddenOrigin"
    )

    // A sandboxed or redirected context sends the literal string "null".
    expect(
      (
        await authServer.handler(
          request("POST", "/api/auth/sign-in/guest", {
            headers: { origin: "null" }
          })
        )
      ).status
    ).toBe(403)

    // Reads are not state-changing and are left to CORS.
    expect(
      (
        await authServer.handler(
          request("GET", "/api/auth/jwks", {
            headers: { origin: "https://evil.example.com" }
          })
        )
      ).status
    ).toBe(200)
  })

  it("allows the forwarded origin, so a proxied app needs no baseURL", async () => {
    // The runtime sees the internal URL and the browser stamps the public one.
    // Without this the same deployment that derives its redirect URI from these
    // headers would refuse every request the browser makes to it.
    const { authServer } = await createTestServer({ guest: true })

    expect(
      (
        await authServer.handler(
          request("POST", "/api/auth/sign-in/guest", {
            origin: "http://10.0.0.5:3000",
            headers: {
              origin: "https://app.example.com",
              "x-forwarded-host": "app.example.com",
              "x-forwarded-proto": "https"
            }
          })
        )
      ).status
    ).toBe(200)

    // The forwarded host is the site's, not a free pass for any origin.
    expect(
      (
        await authServer.handler(
          request("POST", "/api/auth/sign-in/guest", {
            origin: "http://10.0.0.5:3000",
            headers: {
              origin: "https://attacker.example.com",
              "x-forwarded-host": "app.example.com",
              "x-forwarded-proto": "https"
            }
          })
        )
      ).status
    ).toBe(403)
  })

  it("allows its own origin, a configured baseURL, and a trusted origin", async () => {
    const sameOrigin = await createTestServer({ guest: true })
    expect(
      (
        await sameOrigin.authServer.handler(
          request("POST", "/api/auth/sign-in/guest", {
            headers: { origin: "https://app.example.com" }
          })
        )
      ).status
    ).toBe(200)

    // Behind a proxy the runtime sees an internal URL; the browser names the
    // public one, which is what baseURL is for.
    const proxied = await createTestServer({
      guest: true,
      baseURL: "https://auth.example.com"
    })
    expect(
      (
        await proxied.authServer.handler(
          request("POST", "/api/auth/sign-in/guest", {
            origin: "http://10.0.0.5:3000",
            headers: { origin: "https://auth.example.com" }
          })
        )
      ).status
    ).toBe(200)

    const crossOrigin = await createTestServer({
      guest: true,
      trustedOrigins: ["https://spa.example.com"]
    })
    expect(
      (
        await crossOrigin.authServer.handler(
          request("POST", "/api/auth/sign-in/guest", {
            headers: { origin: "https://spa.example.com" }
          })
        )
      ).status
    ).toBe(200)
    expect(
      (
        await crossOrigin.authServer.handler(
          request("POST", "/api/auth/sign-in/guest", {
            headers: { origin: "https://other.example.com" }
          })
        )
      ).status
    ).toBe(403)
  })

  it("passes a request with no Origin header, which is a non-browser client with no cookie to abuse", async () => {
    const { authServer } = await createTestServer({ guest: true })
    expect(
      (await authServer.handler(request("POST", "/api/auth/sign-in/guest")))
        .status
    ).toBe(200)
  })

  it("falls back to Referer when a privacy setting has stripped Origin", async () => {
    const { authServer } = await createTestServer({ guest: true })
    expect(
      (
        await authServer.handler(
          request("POST", "/api/auth/sign-in/guest", {
            headers: { referer: "https://evil.example.com/page" }
          })
        )
      ).status
    ).toBe(403)
    expect(
      (
        await authServer.handler(
          request("POST", "/api/auth/sign-in/guest", {
            headers: { referer: "https://app.example.com/page" }
          })
        )
      ).status
    ).toBe(200)
  })

  it("requires a body to be JSON, so a cross-origin body cannot avoid the preflight", async () => {
    // A page can send text/plain, a form encoding, or a typeless Blob without
    // a preflight; it cannot send application/json without one. So the browser
    // enforces this layer itself, even when Origin has been stripped.
    const { authServer } = await createTestServer({ guest: true })
    const post = (headers: Record<string, string>, body: string) =>
      authServer.handler(
        new Request("https://app.example.com/api/auth/sign-in/code", {
          method: "POST",
          headers,
          body
        })
      )
    const payload = JSON.stringify({ email: "ada@example.com", code: "123456" })

    const textPlain = await post({ "content-type": "text/plain" }, payload)
    expect(textPlain.status).toBe(415)
    expect(((await textPlain.json()) as { code: string }).code).toBe(
      "unsupportedMediaType"
    )
    expect(
      (
        await post(
          { "content-type": "application/x-www-form-urlencoded" },
          "email=ada%40example.com&code=123456"
        )
      ).status
    ).toBe(415)
    // A typeless body still has a length; the missing type is not a pass.
    expect(
      (await post({ "content-length": String(payload.length) }, payload)).status
    ).toBe(415)

    // JSON — with or without a charset parameter — reaches the endpoint.
    expect(
      (await post({ "content-type": "application/json" }, payload)).status
    ).toBe(401)
    expect(
      (
        await post(
          { "content-type": "Application/JSON; charset=utf-8" },
          payload
        )
      ).status
    ).toBe(401)

    // Bodiless requests have no content type to check and are untouched.
    expect(
      (await authServer.handler(request("POST", "/api/auth/sign-in/guest")))
        .status
    ).toBe(200)
  })
})

describe("caching", () => {
  it("marks every response no-store, except the public key set", async () => {
    const { authServer } = await createTestServer({
      jwks: { json: { keys: [] } }
    })

    const refused = await authServer.handler(request("GET", "/api/auth/user"))
    expect(refused.headers.get("cache-control")).toBe("no-store")

    const served = await authServer.handler(request("GET", "/api/auth/jwks"))
    expect(served.headers.get("cache-control")).toBe("public, max-age=3600")
  })
})
