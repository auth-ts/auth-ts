import { describe, expect, it } from "vitest"
import { createAuthServer } from "../../src/core/create-auth-server.ts"
import { AuthConfigError } from "../../src/http/auth-config-error.ts"
import { createMemoryDb } from "../../src/lib/memory-db.ts"
import { generateTestKeys } from "../helpers/generate-test-keys.ts"

const keys = await generateTestKeys("RS256")
const baseOptions = () => ({
  db: createMemoryDb(),
  email: { sendCode: () => {} },
  jwt: { privateKey: keys.privateKeyPem },
  secret: "server-secret"
})

describe("construction failures", () => {
  it("throws when no sign-in method is configured", () => {
    const { email: _email, ...withoutMethod } = baseOptions()

    expect(() => createAuthServer(withoutMethod)).toThrow(AuthConfigError)
    expect(() => createAuthServer(withoutMethod)).toThrow(
      /at least one of: email, sms, guest/
    )
  })

  it("names the missing environment variable for the signing key", () => {
    const { jwt: _jwt, ...withoutKey } = baseOptions()

    expect(() => createAuthServer(withoutKey)).toThrow(/JWT_PRIVATE_KEY/)
  })

  it("names the missing environment variable for the secret", () => {
    const { secret: _secret, ...withoutSecret } = baseOptions()

    expect(() => createAuthServer(withoutSecret)).toThrow(/AUTH_SECRET/)
  })

  it("refuses a secret that is also the signing key", () => {
    expect(() =>
      createAuthServer({ ...baseOptions(), secret: keys.privateKeyPem })
    ).toThrow(/must not be the JWT signing key/)
  })

  it("requires baseURL when providers are configured", () => {
    expect(() =>
      createAuthServer({
        ...baseOptions(),
        providers: { github: { clientId: "id", clientSecret: "secret" } }
      })
    ).toThrow(/baseURL is required/)
  })

  it("rejects a reserved key declared as an additional field", () => {
    for (const reserved of [
      "email",
      "type",
      "id",
      "name",
      "imageURL",
      "primaryUserId",
      "phoneNumber"
    ]) {
      expect(() =>
        createAuthServer({
          ...baseOptions(),
          user: { additionalFields: { [reserved]: "string" } }
        })
      ).toThrow(/core owns that field/)
    }
  })

  it("allows locale as an additional field, since core stores no locale", () => {
    expect(() =>
      createAuthServer({
        ...baseOptions(),
        user: { additionalFields: { locale: "string" } }
      })
    ).not.toThrow()
  })

  it("rejects an unparseable duration, naming the option", () => {
    expect(() =>
      createAuthServer({ ...baseOptions(), session: { ttl: "soon" } })
    ).toThrow(/session.ttl/)
    expect(() =>
      createAuthServer({
        ...baseOptions(),
        jwt: { ...baseOptions().jwt, ttl: "1 month" }
      })
    ).toThrow(/jwt.ttl/)
  })
})

describe("resolved defaults", () => {
  it("applies every documented default", () => {
    const { options } = createAuthServer(baseOptions())

    expect(options.basePath).toBe("/api/auth")
    expect(options.jwt.alg).toBe("RS256")
    expect(options.jwt.ttl).toBe("10m")
    expect(options.jwt.kid).toBe("main")
    expect(options.jwt.claims).toEqual({ role: "authenticated" })
    expect(options.session).toEqual({ ttl: "30d", sliding: true })
    expect(options.cookie.name).toBe("auth-ts.refresh")
    expect(options.cookie.path).toBe("/api/auth")
    expect(options.user.deleteFreshWindow).toBe("15m")
    expect(options.multiAccount).toBe(false)
    expect(options.cleanup).toBe(true)
    expect(options.guest).toBe(false)
    expect(options.logLevel).toBe("warn")
  })

  it("leaves aud unset unless configured, so nothing has to match by accident", () => {
    expect(createAuthServer(baseOptions()).options.jwt.audience).toBeUndefined()
    expect(
      createAuthServer({
        ...baseOptions(),
        jwt: { ...baseOptions().jwt, audience: "authenticated" }
      }).options.jwt.audience
    ).toBe("authenticated")
  })

  it("derives the issuer from baseURL and basePath", () => {
    const { options } = createAuthServer({
      ...baseOptions(),
      baseURL: "https://app.example.com/"
    })

    expect(options.baseURL).toBe("https://app.example.com")
    expect(options.issuer).toBe("https://app.example.com/api/auth")
  })

  it("defaults the cookie path to basePath and keeps an explicit override", () => {
    expect(
      createAuthServer({ ...baseOptions(), basePath: "/auth" }).options.cookie
        .path
    ).toBe("/auth")
    expect(
      createAuthServer({ ...baseOptions(), cookie: { path: "/" } }).options
        .cookie.path
    ).toBe("/")
  })

  it("merges partial rate limits over the defaults", () => {
    const { options } = createAuthServer({
      ...baseOptions(),
      rateLimit: { sendCodePerIdentifier: { max: 9, window: "1h" } }
    })

    expect(options.rateLimit).toMatchObject({
      sendCodePerIdentifier: { max: 9, window: "1h" },
      sendCodePerIP: { max: 30, window: "10m" },
      sendCodeCooldown: "60s"
    })
  })

  it("reads secrets from the environment when not supplied", () => {
    const { jwt: _jwt, secret: _secret, ...fromEnvironment } = baseOptions()
    process.env.JWT_PRIVATE_KEY = keys.privateKeyPem
    process.env.AUTH_SECRET = "environment-secret"

    try {
      expect(createAuthServer(fromEnvironment).options.secret).toBe(
        "environment-secret"
      )
    } finally {
      process.env.JWT_PRIVATE_KEY = undefined
      process.env.AUTH_SECRET = undefined
    }
  })
})
