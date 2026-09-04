import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { AdditionalFieldsSchema } from "../../src/core/auth-database"
import { createAuth } from "../../src/core/create-auth"
import { AuthConfigError } from "../../src/http/auth-config-error"
import { createMemoryDatabase } from "../../src/lib/memory-database"
import { generateTestKeys } from "../helpers/generate-test-keys"

const keys = await generateTestKeys("RS256")

/** The variables `createAuth` falls back to when an option is missing. */
const SECRET_ENVIRONMENT_KEYS = ["JWT_PRIVATE_KEY", "AUTH_SECRET"] as const

/**
 * Runs every test against a known-empty environment, and hands the real one back
 * afterwards.
 *
 * Half this file asserts that construction *fails* when a secret is missing, and
 * a developer working on an auth library is exactly the person likely to have
 * `AUTH_SECRET` exported in their shell — which would satisfy the fallback and
 * turn those tests green for the wrong reason.
 */
beforeEach(() => {
  for (const key of SECRET_ENVIRONMENT_KEYS) {
    previousEnvironment[key] = process.env[key]
    // `delete`, never `= undefined`: Node coerces an assigned value to a string,
    // so the variable would survive as the literal "undefined" and read back as
    // a perfectly usable secret.
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of SECRET_ENVIRONMENT_KEYS) {
    const previous = previousEnvironment[key]
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
  }
})

const previousEnvironment: Record<string, string | undefined> = {}
const baseOptions = () => ({
  database: createMemoryDatabase(),
  email: { sendCode: () => {} },
  jwt: { privateKey: keys.privateKeyPem },
  secret: "server-secret-long-enough-to-pass-the-floor"
})

describe("construction failures", () => {
  it("throws when no sign-in method is configured", () => {
    const { email: _email, ...withoutMethod } = baseOptions()

    expect(() => createAuth(withoutMethod)).toThrow(AuthConfigError)
    expect(() => createAuth(withoutMethod)).toThrow(
      /at least one of: email, sms, guest/
    )
  })

  it("names the missing environment variable for the signing key", () => {
    const { jwt: _jwt, ...withoutKey } = baseOptions()

    expect(() => createAuth(withoutKey)).toThrow(/JWT_PRIVATE_KEY/)
  })

  it("names the missing environment variable for the secret", () => {
    const { secret: _secret, ...withoutSecret } = baseOptions()

    expect(() => createAuth(withoutSecret)).toThrow(/AUTH_SECRET/)
  })

  it("refuses a secret that is also the signing key", () => {
    expect(() =>
      createAuth({ ...baseOptions(), secret: keys.privateKeyPem })
    ).toThrow(/must not be the JWT signing key/)
  })

  it("refuses a secret short enough to guess offline", () => {
    // Every OAuth sign-in hands the browser an HMAC of a known message under
    // this key, so a short one is attacked offline rather than online.
    expect(() => createAuth({ ...baseOptions(), secret: "hunter2" })).toThrow(
      /at least 32 characters/
    )
  })

  it("refuses jwks.json that is not a parsed key set", () => {
    for (const json of ['{"keys":[]}', "./public/jwks.json", { kid: "k1" }]) {
      expect(() => createAuth({ ...baseOptions(), jwks: { json } })).toThrow(
        /jwks\.json must be the parsed key set/
      )
    }
    expect(() =>
      createAuth({ ...baseOptions(), jwks: { json: { keys: [] } } })
    ).not.toThrow()
    expect(() =>
      createAuth({
        ...baseOptions(),
        jwks: { url: "https://app.example.com/jwks.json" }
      })
    ).not.toThrow()
  })

  it("leaves baseURL unset, providers or not, and reads no environment variable", () => {
    process.env.AUTH_BASE_URL = "https://from-the-environment.example.com"
    try {
      const { config } = createAuth({
        ...baseOptions(),
        providers: { github: { clientId: "id", clientSecret: "secret" } }
      })

      // Absent, not defaulted: the origin is derived per request instead, and
      // no environment variable stands behind the option.
      expect(config.baseURL).toBeUndefined()
      expect(config.issuer).toBeUndefined()
    } finally {
      delete process.env.AUTH_BASE_URL
    }
  })

  it("refuses a provider whose credentials are missing or empty", () => {
    // `process.env.GITHUB_CLIENT_ID as string` is the documented pattern, and
    // an unset variable makes that undefined with no help from the types.
    for (const credentials of [
      { clientId: undefined, clientSecret: "secret" },
      { clientId: "", clientSecret: "secret" },
      { clientId: "id", clientSecret: undefined },
      { clientId: "id", clientSecret: "" },
      { clientId: 42, clientSecret: "secret" }
    ]) {
      expect(() =>
        createAuth({
          ...baseOptions(),
          baseURL: "https://app.example.com",
          providers: {
            github: credentials as unknown as {
              clientId: string
              clientSecret: string
            }
          }
        })
      ).toThrow(/providers\.github\.client(Id|Secret) is missing or empty/)
    }
  })

  it("warns at construction only when tracking is off, not by default", () => {
    // Deriving an address needs no configuration, so the default must not nag.
    // Turning tracking off leaves the per-IP limits configured and inert, which
    // is the one case construction can see; a deployment where no usable header
    // ever arrives is a request-time discovery, warned about there.
    const warnings = (overrides: Record<string, unknown>) => {
      const calls: string[] = []
      createAuth({
        ...baseOptions(),
        logger: (level, message) => {
          if (level === "warn") calls.push(message)
        },
        ...overrides
      })
      return calls.filter((message) => message.includes("per-IP rate limits"))
    }

    expect(warnings({})).toHaveLength(0)
    expect(warnings({ ipAddress: { trustedProxies: 1 } })).toHaveLength(0)
    expect(warnings({ ipAddress: { disableTracking: true } })).toHaveLength(1)
    expect(warnings({ ipAddress: { disableTracking: true } })[0]).toMatch(
      /disableTracking is on/
    )
    expect(
      warnings({ ipAddress: { disableTracking: true }, rateLimit: false })
    ).toHaveLength(0)
  })

  it("rejects a reserved key declared as an additional field", () => {
    for (const reserved of [
      "email",
      "type",
      "id",
      "name",
      "image",
      "primaryUserId",
      "phoneNumber"
    ]) {
      expect(() =>
        createAuth({
          ...baseOptions(),
          user: {
            additionalFields: { [reserved]: "string" } as AdditionalFieldsSchema
          }
        })
      ).toThrow(/core owns that field/)
    }
  })

  it("allows locale as an additional field, since core stores no locale", () => {
    expect(() =>
      createAuth({
        ...baseOptions(),
        user: { additionalFields: { locale: "string" } }
      })
    ).not.toThrow()
  })

  it("rejects an invalid rate-limit window at construction, not on the first request", () => {
    // Regression: windows skipped the duration check every other option gets,
    // so a typo was accepted here and threw inside the limiter at request time.
    // "1 month" rather than "10 minutes": plurals and spaces are valid in the
    // duration grammar, and months are the one unit it deliberately refuses.
    expect(() =>
      createAuth({
        ...baseOptions(),
        rateLimit: { sendCodePerIP: { max: 30, window: "1 month" } }
      })
    ).toThrow(/rateLimit.sendCodePerIP.window/)
    expect(() =>
      createAuth({
        ...baseOptions(),
        rateLimit: { sendCodeCooldown: "soon" }
      })
    ).toThrow(/rateLimit.sendCodeCooldown/)
  })

  it("rejects a token or session lifetime under one second, which rounds to zero", () => {
    // `exp` and `Max-Age` are whole seconds, rounded down: a sub-second TTL
    // mints tokens with `exp === iat` and cookies the browser drops on arrival.
    for (const ttl of ["0s", "0.5s"]) {
      expect(() =>
        createAuth({
          ...baseOptions(),
          jwt: { ...baseOptions().jwt, ttl }
        })
      ).toThrow(/jwt\.ttl: must be at least one second/)
      expect(() => createAuth({ ...baseOptions(), session: { ttl } })).toThrow(
        /session\.ttl: must be at least one second/
      )
    }
    // One whole second is the floor, not a mistake.
    expect(() =>
      createAuth({
        ...baseOptions(),
        jwt: { ...baseOptions().jwt, ttl: "1s" },
        session: { ttl: "1s" }
      })
    ).not.toThrow()
  })

  it("rejects a negative duration, which parses but expires everything at birth", () => {
    // The duration grammar accepts a leading `-`, so these are well-formed and
    // used to pass. A negative TTL hands out sessions and tokens that expired
    // before they were issued; a negative window starts in the future.
    expect(() =>
      createAuth({ ...baseOptions(), session: { ttl: "-30d" } })
    ).toThrow(/session\.ttl/)
    expect(() =>
      createAuth({
        ...baseOptions(),
        jwt: { ...baseOptions().jwt, ttl: "-10m" }
      })
    ).toThrow(/jwt\.ttl/)
    expect(() =>
      createAuth({ ...baseOptions(), user: { deleteFreshWindow: "-1m" } })
    ).toThrow(/user\.deleteFreshWindow/)
    expect(() =>
      createAuth({
        ...baseOptions(),
        rateLimit: { sendCodePerIP: { max: 30, window: "-10m" } }
      })
    ).toThrow(/rateLimit\.sendCodePerIP\.window/)
    expect(() =>
      createAuth({
        ...baseOptions(),
        rateLimit: { sendCodeCooldown: "-60s" }
      })
    ).toThrow(/rateLimit\.sendCodeCooldown/)
  })

  it("rejects a duration too large for a Date, naming the option", () => {
    expect(() =>
      createAuth({
        ...baseOptions(),
        session: { ttl: `1${"0".repeat(400)}d` }
      })
    ).toThrow(/session\.ttl.*out of range/)
  })

  it("still accepts a zero duration, which deleteFreshWindow documents", () => {
    // `"0s"` means no session is ever fresh enough to skip the emailed code —
    // a real setting, not a mistake, so the negative check must stop at zero.
    expect(() =>
      createAuth({ ...baseOptions(), user: { deleteFreshWindow: "0s" } })
    ).not.toThrow()
  })

  it("rejects a zero rate-limit window, which would silently disable the limit", () => {
    // The store resets the count whenever `resetAt <= now()`, so a window that
    // ends the instant it starts counts every request as the first one. Unlike
    // `deleteFreshWindow`, zero is never a setting here — only a mistake.
    expect(() =>
      createAuth({
        ...baseOptions(),
        rateLimit: { sendCodePerIP: { max: 30, window: "0s" } }
      })
    ).toThrow(/rateLimit\.sendCodePerIP\.window must be a positive duration/)
    // Sub-millisecond rounds to the same thing once added to a Date.
    expect(() =>
      createAuth({
        ...baseOptions(),
        rateLimit: { signInCodePerIP: { max: 30, window: "0.0001s" } }
      })
    ).toThrow(/rateLimit\.signInCodePerIP\.window must be a positive duration/)
    // The cooldown is a spacing, not a window: zero means "no spacing" and stays legal.
    expect(() =>
      createAuth({
        ...baseOptions(),
        rateLimit: { sendCodeCooldown: "0s" }
      })
    ).not.toThrow()
  })

  it("rejects a non-positive or fractional rate-limit max", () => {
    expect(() =>
      createAuth({
        ...baseOptions(),
        rateLimit: { sendCodePerIP: { max: 0, window: "10m" } }
      })
    ).toThrow(/rateLimit.sendCodePerIP.max/)
    expect(() =>
      createAuth({
        ...baseOptions(),
        rateLimit: { signInCodePerIP: { max: 2.5, window: "10m" } }
      })
    ).toThrow(/rateLimit.signInCodePerIP.max/)
  })

  it("refuses sub, iat, and exp as configured default claims", () => {
    for (const owned of ["sub", "iat", "exp"]) {
      expect(
        () =>
          createAuth({
            ...baseOptions(),
            jwt: { ...baseOptions().jwt, claims: { [owned]: "x" } }
          }),
        owned
      ).toThrow(new RegExp(`jwt\\.claims.*"${owned}"`))
    }
    // Anything else is the consumer's to set.
    expect(
      createAuth({
        ...baseOptions(),
        jwt: { ...baseOptions().jwt, claims: { role: "app_user", tier: 2 } }
      }).config.jwt.claims
    ).toEqual({ role: "app_user", tier: 2 })
  })

  it("takes a claims function as-is, since construction cannot inspect it", () => {
    const claims = () => ({ role: "authenticated" })

    expect(
      createAuth({
        ...baseOptions(),
        jwt: { ...baseOptions().jwt, claims }
      }).config.jwt.claims
    ).toBe(claims)
  })

  it("rejects a trustedProxies count that could never address an entry", () => {
    // Each of these would not error at request time — getIpAddress would index
    // the chain at a position that does not exist, derive nothing, and every
    // per-IP limit would be silently off.
    for (const trustedProxies of [1.5, -1, Infinity, Number.NaN]) {
      expect(
        () =>
          createAuth({
            ...baseOptions(),
            ipAddress: { trustedProxies }
          }),
        String(trustedProxies)
      ).toThrow(/ipAddress\.trustedProxies/)
    }
  })

  it("accepts whole proxy counts and the boolean shorthand", () => {
    for (const [trustedProxies, expected] of [
      [0, 0],
      [2, 2],
      [true, 1],
      [false, 0]
    ] as const) {
      expect(
        createAuth({ ...baseOptions(), ipAddress: { trustedProxies } }).config
          .ipAddress.trustedProxies
      ).toBe(expected)
    }
  })

  it("rejects a trusted proxy entry that is not an address or range", () => {
    // An entry that parses as neither matches no hop, so a typo would quietly
    // turn the list into "trust nothing" and take every per-IP limit with it.
    for (const entry of ["not-an-ip", "10.0.0.0/33", "10.0.0.0/", ""]) {
      expect(
        () =>
          createAuth({
            ...baseOptions(),
            ipAddress: { trustedProxies: [entry] }
          }),
        entry
      ).toThrow(/ipAddress\.trustedProxies/)
    }

    expect(
      createAuth({
        ...baseOptions(),
        ipAddress: { trustedProxies: ["203.0.113.7", "10.0.0.0/24", "::1"] }
      }).config.ipAddress.trustedProxies
    ).toEqual(["203.0.113.7", "10.0.0.0/24", "::1"])
  })

  it("rejects a prefix length that is not somewhere inside an IPv6 address", () => {
    for (const ipv6Subnet of [-1, 129, 64.5, Number.NaN]) {
      expect(
        () => createAuth({ ...baseOptions(), ipAddress: { ipv6Subnet } }),
        String(ipv6Subnet)
      ).toThrow(/ipAddress\.ipv6Subnet/)
    }

    expect(createAuth(baseOptions()).config.ipAddress.ipv6Subnet).toBe(64)
  })

  it("rejects an empty header list, which would leave nothing to read", () => {
    expect(() =>
      createAuth({ ...baseOptions(), ipAddress: { headers: [] } })
    ).toThrow(/ipAddress\.headers/)
    expect(() =>
      createAuth({ ...baseOptions(), ipAddress: { headers: [""] } })
    ).toThrow(/ipAddress\.headers/)
  })

  it("treats an explicit undefined override as absent, keeping the default", () => {
    // Regression: a spread copied `undefined` over the default, so the limiter
    // read `.max` off `undefined` and every send failed with internalError.
    const { config } = createAuth({
      ...baseOptions(),
      rateLimit: { sendCodePerIP: undefined }
    })

    expect(config.rateLimit).toMatchObject({
      sendCodePerIP: { max: 30, window: "10m" }
    })
  })

  it("rejects an unparseable duration, naming the option", () => {
    expect(() =>
      createAuth({ ...baseOptions(), session: { ttl: "soon" } })
    ).toThrow(/session.ttl/)
    expect(() =>
      createAuth({
        ...baseOptions(),
        jwt: { ...baseOptions().jwt, ttl: "1 month" }
      })
    ).toThrow(/jwt.ttl/)
  })
})

describe("resolved defaults", () => {
  it("applies every documented default", () => {
    const { config } = createAuth(baseOptions())

    expect(config.basePath).toBe("/api/auth")
    expect(config.jwt.alg).toBe("RS256")
    expect(config.jwt.ttl).toBe("10m")
    expect(config.jwt.claims).toEqual({ role: "authenticated" })
    expect(config.session).toEqual({ ttl: "30d", sliding: true })
    expect(config.cookie.name).toBe("auth-ts.refresh")
    expect(config.cookie.path).toBe("/")
    expect(config.user.deleteFreshWindow).toBe("15m")
    expect(config.multiUser).toBe(false)
    expect(config.guest).toBe(false)
    expect(config.logLevel).toBe("warn")
  })

  it("leaves generateId unset by default and carries the one given", () => {
    // Unset is the common case: the row goes to the store without an id and the
    // column default fills it. Configured, core mints the id itself, so the
    // resolved config has to be carrying the exact function it was handed.
    expect(createAuth(baseOptions()).config.generateId).toBeUndefined()

    const generateId = (table: string) => `${table}_1`
    expect(createAuth({ ...baseOptions(), generateId }).config.generateId).toBe(
      generateId
    )
  })

  it("leaves aud unset unless configured, so nothing has to match by accident", () => {
    expect(createAuth(baseOptions()).config.jwt.audience).toBeUndefined()
    expect(
      createAuth({
        ...baseOptions(),
        jwt: { ...baseOptions().jwt, audience: "authenticated" }
      }).config.jwt.audience
    ).toBe("authenticated")
  })

  it("derives the issuer from baseURL and basePath", () => {
    const { config } = createAuth({
      ...baseOptions(),
      baseURL: "https://app.example.com/"
    })

    expect(config.baseURL).toBe("https://app.example.com")
    expect(config.issuer).toBe("https://app.example.com/api/auth")
  })

  it("keeps the cookie path at the root whatever the mount, unless narrowed", () => {
    // The mount moves the endpoints and the OAuth callbacks; it must not move
    // the cookie out of reach of a page request, which is where the session is
    // read during server-side rendering.
    expect(
      createAuth({ ...baseOptions(), basePath: "/auth" }).config.cookie.path
    ).toBe("/")
    expect(
      createAuth({ ...baseOptions(), cookie: { path: "/api/auth" } }).config
        .cookie.path
    ).toBe("/api/auth")
  })

  it("merges partial rate limits over the defaults", () => {
    const { config } = createAuth({
      ...baseOptions(),
      rateLimit: { sendCodePerIdentifier: { max: 9, window: "1h" } }
    })

    expect(config.rateLimit).toMatchObject({
      sendCodePerIdentifier: { max: 9, window: "1h" },
      sendCodePerIP: { max: 30, window: "10m" },
      sendCodeCooldown: "60s"
    })
  })

  it("reads secrets from the environment when not supplied", () => {
    const { jwt: _jwt, secret: _secret, ...fromEnvironment } = baseOptions()
    process.env.JWT_PRIVATE_KEY = keys.privateKeyPem
    process.env.AUTH_SECRET = "environment-secret-long-enough-to-pass"

    // Cleanup belongs to afterEach, so a failure here cannot leave the variables
    // set for whatever runs next.
    expect(createAuth(fromEnvironment).config.secret).toBe(
      "environment-secret-long-enough-to-pass"
    )
  })

  it("starts each test with the fallback variables genuinely absent", () => {
    // The invariant the whole file's missing-secret assertions rest on. It fails
    // if the guard is removed and the developer running the suite exports either
    // variable, or if the afterEach teardown ever goes back to assigning
    // `undefined` — which Node stringifies into a perfectly usable secret.
    expect("AUTH_SECRET" in process.env).toBe(false)
    expect("JWT_PRIVATE_KEY" in process.env).toBe(false)
  })
})
