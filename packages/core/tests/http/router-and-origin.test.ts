import { describe, expect, it } from "vitest"
import { createTestServer } from "../helpers/create-test-server"
import { request } from "../helpers/request"

describe("matchRoute", () => {
  it("dispatches every documented endpoint through the catch-all", async () => {
    const { auth } = await createTestServer({
      guest: true,
      multiUser: true,
      jwks: { json: { keys: [] } }
    })

    // Unauthenticated is fine here — what matters is that none of these 404.
    const probes: Array<[string, string]> = [
      ["POST", "/api/auth/sign-in/send-code"],
      ["GET", "/api/auth/token"],
      ["POST", "/api/auth/sign-in/code"],
      ["POST", "/api/auth/sign-out"],
      ["POST", "/api/auth/user"],
      ["DELETE", "/api/auth/user"],
      ["POST", "/api/auth/user/verify/send-code"],
      ["POST", "/api/auth/user/verify"],
      ["DELETE", "/api/auth/sessions/abc"],
      ["GET", "/api/auth/users"],
      ["POST", "/api/auth/users/switch"],
      ["POST", "/api/auth/sign-in/guest"],
      ["GET", "/api/auth/identities/abc/token"],
      ["GET", "/api/auth/jwks"]
    ]

    for (const [method, path] of probes) {
      const response = await auth.handler(request(method, path))
      expect([method, path, response.status]).not.toEqual([method, path, 404])
    }
  })

  it("tolerates a trailing slash", async () => {
    const { auth } = await createTestServer({
      jwks: { json: { keys: [] } }
    })
    expect((await auth.handler(request("GET", "/api/auth/jwks/"))).status).toBe(
      200
    )
  })

  it("answers 405 for a known path with the wrong method, not 404", async () => {
    const { auth } = await createTestServer()
    const response = await auth.handler(
      request("GET", "/api/auth/sign-in/send-code")
    )

    expect(response.status).toBe(405)
    expect(((await response.json()) as { code: string }).code).toBe(
      "methodNotAllowed"
    )
  })

  it("refuses the wrong method on a directly mounted handler before parsing", async () => {
    // The router is not in front of `auth.handlers.*`, so the handler has
    // to enforce its own method. Without this a GET fell into `parse` and `run`.
    const { auth } = await createTestServer()
    const response = await auth.handlers.sendSignInCode(
      request("GET", "/api/auth/sign-in/send-code")
    )

    expect(response.status).toBe(405)
    expect(((await response.json()) as { code: string }).code).toBe(
      "methodNotAllowed"
    )
  })

  it("keeps the router's 404 for an unknown path, whatever the method", async () => {
    // Regression guard for the handler's method check: the fallback endpoint
    // behind the catch-all must not turn a routing 404 into a 405.
    const { auth } = await createTestServer()
    for (const method of ["GET", "POST", "DELETE"]) {
      const response = await auth.handler(request(method, "/api/auth/nope"))
      expect(response.status, method).toBe(404)
    }
  })

  it("404s anything outside the mount", async () => {
    const { auth } = await createTestServer()

    expect((await auth.handler(request("GET", "/somewhere-else"))).status).toBe(
      404
    )
  })

  it("keeps a provider name from ever shadowing a literal sign-in route", async () => {
    // Providers sit one level down, under /sign-in/provider/:provider, so a
    // provider called `guest` or `code` reaches its own path and the literal
    // routes keep theirs. That is what replaced the reserved-names list: a
    // collision that cannot be expressed rather than one that is forbidden.
    const { auth } = await createTestServer({
      guest: true,
      baseURL: "https://app.example.com",
      providers: { github: { clientId: "id", clientSecret: "secret" } }
    })

    expect(
      (await auth.handler(request("POST", "/api/auth/sign-in/guest"))).status
    ).toBe(200)
    // The literal path answers only its own method; nothing dynamic is mounted
    // beside it to pick the request up.
    expect(
      (await auth.handler(request("GET", "/api/auth/sign-in/guest"))).status
    ).toBe(405)
    expect(
      (await auth.handler(request("POST", "/api/auth/sign-in/provider/github")))
        .status
    ).toBe(200)
  })

  it("keeps a percent-encoded slash inside one segment", async () => {
    const { auth } = await createTestServer()

    // %2F must not split into two segments, or an id could smuggle a path.
    const response = await auth.handler(
      request("GET", "/api/auth/identities/abc%2Fdef/token")
    )
    expect(response.status).toBe(401)
  })

  it("answers 404 for malformed percent-encoding instead of throwing or 500ing", async () => {
    // decodeURIComponent throws URIError on these. Before the guard, the
    // catch-all re-threw it out of auth.handler entirely, and a directly
    // mounted handler turned it into a 500.
    const { auth } = await createTestServer()

    for (const path of [
      "/api/auth/%zz",
      "/api/auth/identities/%/token",
      "/api/auth/%E0%A4%A"
    ]) {
      const viaCatchAll = await auth.handler(request("GET", path))
      expect(viaCatchAll.status, `catch-all ${path}`).toBe(404)

      const viaRoute = await auth.handlers.getProviderToken(
        request("GET", path)
      )
      expect(viaRoute.status, `per-route ${path}`).toBeLessThan(500)
    }
  })

  it("honours a custom basePath, including one written with a trailing slash", async () => {
    const { auth } = await createTestServer({
      basePath: "/auth/",
      jwks: { json: { keys: [] } }
    })

    expect(auth.config.basePath).toBe("/auth")
    expect((await auth.handler(request("GET", "/auth/jwks"))).status).toBe(200)
    expect((await auth.handler(request("GET", "/api/auth/jwks"))).status).toBe(
      404
    )
  })
})

describe("origin check", () => {
  // The book's check: every non-GET request must say Sec-Fetch-Site:
  // same-origin. The browser sets the header and forbids a page from touching
  // it, so a cross-site page cannot forge it. Origin is consulted only as the
  // allowlist for the requests that cannot say same-origin.
  const guest = (headers: Record<string, string>, origin?: string) =>
    request("POST", "/api/auth/sign-in/guest", { headers, origin })

  it("refuses a cross-site request, whatever its Origin claims", async () => {
    const { auth } = await createTestServer({
      guest: true,
      jwks: { json: { keys: [] } }
    })

    const refused = await auth.handler(
      guest({
        "sec-fetch-site": "cross-site",
        origin: "https://evil.example.com"
      })
    )
    expect(refused.status).toBe(403)
    expect(((await refused.json()) as { code: string }).code).toBe(
      "forbiddenOrigin"
    )

    // A sandboxed or redirected context sends the literal string "null".
    expect(
      (
        await auth.handler(
          guest({ "sec-fetch-site": "cross-site", origin: "null" })
        )
      ).status
    ).toBe(403)

    // Reads are not state-changing and are left to CORS.
    expect(
      (
        await auth.handler(
          request("GET", "/api/auth/jwks", {
            headers: {
              "sec-fetch-site": "cross-site",
              origin: "https://evil.example.com"
            }
          })
        )
      ).status
    ).toBe(200)
  })

  it("refuses a request with no Sec-Fetch-Site and no Origin", async () => {
    // A browser too old for the header is refused rather than trusted; a
    // client that is not a browser says the header itself.
    const { auth } = await createTestServer({ guest: true })
    const bare = (headers: Record<string, string>) =>
      new Request("https://app.example.com/api/auth/sign-in/guest", {
        method: "POST",
        headers
      })

    expect((await auth.handler(bare({}))).status).toBe(403)
    expect(
      (await auth.handler(bare({ "sec-fetch-site": "same-origin" }))).status
    ).toBe(200)
  })

  it("trusts same-origin over any Origin header, which a browser never contradicts", async () => {
    const { auth } = await createTestServer({ guest: true })
    expect(
      (
        await auth.handler(
          guest({
            "sec-fetch-site": "same-origin",
            origin: "https://evil.example.com"
          })
        )
      ).status
    ).toBe(200)
  })

  it("falls back to an allowlisted Origin for an older browser or a sibling origin", async () => {
    // No header at all, own origin: the browser predates Sec-Fetch-Site.
    const sameOrigin = await createTestServer({ guest: true })
    expect(
      (
        await sameOrigin.auth.handler(
          guest({ "sec-fetch-site": "", origin: "https://app.example.com" })
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
        await proxied.auth.handler(
          guest(
            {
              "sec-fetch-site": "same-site",
              origin: "https://auth.example.com"
            },
            "http://10.0.0.5:3000"
          )
        )
      ).status
    ).toBe(200)

    const crossOrigin = await createTestServer({
      guest: true,
      trustedOrigins: ["https://spa.example.com"]
    })
    expect(
      (
        await crossOrigin.auth.handler(
          guest({
            "sec-fetch-site": "same-site",
            origin: "https://spa.example.com"
          })
        )
      ).status
    ).toBe(200)
    expect(
      (
        await crossOrigin.auth.handler(
          guest({
            "sec-fetch-site": "same-site",
            origin: "https://other.example.com"
          })
        )
      ).status
    ).toBe(403)
  })

  it("ignores a forwarded origin unless the proxy headers are trusted", async () => {
    const { auth } = await createTestServer({ guest: true })

    // Nothing marks these as a proxy's rather than the sender's, so off by
    // default they buy an origin nothing: the request is judged on its own.
    expect(
      (
        await auth.handler(
          guest(
            {
              "sec-fetch-site": "cross-site",
              origin: "https://attacker.example.com",
              "x-forwarded-host": "attacker.example.com",
              "x-forwarded-proto": "https"
            },
            "http://10.0.0.5:3000"
          )
        )
      ).status
    ).toBe(403)
  })

  it("allows the forwarded origin once the proxy headers are trusted", async () => {
    // The runtime sees the internal URL and the browser stamps the public one.
    // Without this the same deployment that derives its redirect URI from these
    // headers would refuse every request the browser makes to it.
    const { auth } = await createTestServer({
      guest: true,
      trustedProxyHeaders: true
    })

    expect(
      (
        await auth.handler(
          guest(
            {
              "sec-fetch-site": "cross-site",
              origin: "https://app.example.com",
              "x-forwarded-host": "app.example.com",
              "x-forwarded-proto": "https"
            },
            "http://10.0.0.5:3000"
          )
        )
      ).status
    ).toBe(200)

    // The forwarded host is the site's, not a free pass for any origin.
    expect(
      (
        await auth.handler(
          guest(
            {
              "sec-fetch-site": "cross-site",
              origin: "https://attacker.example.com",
              "x-forwarded-host": "app.example.com",
              "x-forwarded-proto": "https"
            },
            "http://10.0.0.5:3000"
          )
        )
      ).status
    ).toBe(403)
  })

  it("requires a body to be JSON in utf-8, so a cross-origin body cannot avoid the preflight", async () => {
    // A page can send text/plain, a form encoding, or a typeless Blob without
    // a preflight; it cannot send application/json without one. So the browser
    // enforces this layer itself.
    const { auth } = await createTestServer({ guest: true })
    const post = (headers: Record<string, string>, body: string) =>
      auth.handler(
        new Request("https://app.example.com/api/auth/sign-in/code", {
          method: "POST",
          headers: { "sec-fetch-site": "same-origin", ...headers },
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
    // The one charset a parameter may name is utf-8.
    expect(
      (
        await post(
          { "content-type": "application/json; charset=latin1" },
          payload
        )
      ).status
    ).toBe(415)

    // JSON — with or without the utf-8 charset — reaches the endpoint.
    expect(
      (await post({ "content-type": "application/json" }, payload)).status
    ).toBe(401)
    expect(
      (
        await post(
          { "content-type": "Application/JSON; charset=UTF-8" },
          payload
        )
      ).status
    ).toBe(401)

    // Bodiless requests have no content type to check and are untouched.
    expect(
      (await auth.handler(request("POST", "/api/auth/sign-in/guest"))).status
    ).toBe(200)
  })
})

describe("caching", () => {
  it("marks every response no-store, except the public key set", async () => {
    const { auth } = await createTestServer({
      jwks: { json: { keys: [] } }
    })

    const refused = await auth.handler(request("GET", "/api/auth/user"))
    expect(refused.headers.get("cache-control")).toBe("no-store")

    const served = await auth.handler(request("GET", "/api/auth/jwks"))
    expect(served.headers.get("cache-control")).toBe("public, max-age=3600")
  })
})
