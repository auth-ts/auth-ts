import { decodeJwt, importSPKI, SignJWT } from "jose"
import { beforeAll, describe, expect, it } from "vitest"
import { buildJwks } from "../../src/jwt/build-jwks.ts"
import { decodeToken } from "../../src/jwt/decode-token.ts"
import {
  importAdditionalPublicKey,
  importSigningKey
} from "../../src/jwt/import-signing-key.ts"
import type { SignTokenContext } from "../../src/jwt/sign-token.ts"
import { signToken } from "../../src/jwt/sign-token.ts"
import type { VerifyTokenContext } from "../../src/jwt/verify-token.ts"
import { verifyToken } from "../../src/jwt/verify-token.ts"
import { generateTestKeys } from "../helpers/generate-test-keys.ts"

let signContext: SignTokenContext
let verifyContext: VerifyTokenContext
let publicKeyPem: string

beforeAll(async () => {
  const keys = await generateTestKeys("RS256")
  publicKeyPem = keys.publicKeyPem
  const { signingKey, verificationKey, publicJwk } = await importSigningKey(
    keys.privateKeyPem,
    "RS256",
    "main"
  )

  signContext = {
    signingKey,
    algorithm: "RS256",
    kid: "main",
    ttl: "10m",
    claims: { role: "authenticated" },
    issuer: "https://app.example.com/api/auth",
    audience: "authenticated"
  }
  verifyContext = {
    verificationKey,
    algorithm: "RS256",
    issuer: "https://app.example.com/api/auth",
    audience: "authenticated"
  }
  expect(publicJwk.kid).toBe("main")
})

describe("signToken", () => {
  it("round-trips through verifyToken", async () => {
    const token = await signToken(signContext, {
      userId: "user-1",
      type: "user"
    })
    const claims = await verifyToken(verifyContext, token)

    expect(claims?.sub).toBe("user-1")
    expect(claims?.type).toBe("user")
  })

  it("puts userId in sub and keeps role authenticated for everyone", async () => {
    const token = await signToken(signContext, {
      userId: "user-1",
      type: "admin"
    })
    const claims = await verifyToken(verifyContext, token)

    expect(claims?.sub).toBe("user-1")
    expect(claims?.role).toBe("authenticated")
    expect(claims?.type).toBe("admin")
  })

  it("lets caller claims win over configured claims", async () => {
    const token = await signToken(signContext, {
      userId: "user-1",
      role: "service",
      tenant: "acme"
    })
    const claims = await verifyToken(verifyContext, token)

    expect(claims?.role).toBe("service")
    expect(claims?.tenant).toBe("acme")
  })

  it("defaults iss and aud from the context", async () => {
    const token = await signToken(signContext, { userId: "user-1" })
    const claims = await verifyToken(verifyContext, token)

    expect(claims?.iss).toBe("https://app.example.com/api/auth")
    expect(claims?.aud).toBe("authenticated")
  })

  it("lets the caller override iss and aud", async () => {
    // Widened so the `never`-free keys can be passed without a cast.
    const custom: Record<string, unknown> = {
      iss: "https://other.example",
      aud: "reporting"
    }
    const token = await signToken(signContext, custom)
    const claims = decodeJwt(token)

    expect(claims.iss).toBe("https://other.example")
    expect(claims.aud).toBe("reporting")
    // And it no longer passes this server's own verification, as it should.
    await expect(verifyToken(verifyContext, token)).resolves.toBeNull()
  })

  it("keeps iat and exp server-owned even when a widened payload carries them", async () => {
    const smuggled: Record<string, unknown> = {
      iat: 1,
      exp: 4_102_444_800 // 2100-01-01
    }
    const token = await signToken(signContext, smuggled)
    const claims = await verifyToken(verifyContext, token)

    expect(claims?.iat).not.toBe(1)
    expect(claims?.exp).toBe((claims?.iat ?? 0) + 600)
  })

  it("keeps sub as userId's alone, dropping one smuggled through a widened payload", async () => {
    // Same hole as iat/exp, but setSubject only runs when userId is given, so
    // a stripped type was the only thing between a smuggled sub and the token.
    const smuggled: Record<string, unknown> = { sub: "someone-else" }
    expect(
      (await verifyToken(verifyContext, await signToken(signContext, smuggled)))
        ?.sub
    ).toBeUndefined()

    const overridden: Record<string, unknown> = {
      userId: "user-1",
      sub: "someone-else"
    }
    expect(
      (
        await verifyToken(
          verifyContext,
          await signToken(signContext, overridden)
        )
      )?.sub
    ).toBe("user-1")
  })

  it("mints a service token with no subject at all", async () => {
    const token = await signToken(signContext, { role: "service" })
    const claims = await verifyToken(verifyContext, token)

    expect(claims?.sub).toBeUndefined()
    expect(claims?.role).toBe("service")
  })

  it("carries kid in the header, which Supabase requires", async () => {
    const token = await signToken(signContext, { userId: "user-1" })
    const header = JSON.parse(atob(token.split(".")[0] ?? ""))

    expect(header.kid).toBe("main")
    expect(header.alg).toBe("RS256")
  })

  it("emits only the expected claims", async () => {
    const token = await signToken(signContext, {
      userId: "user-1",
      type: "user"
    })
    const claims = await verifyToken(verifyContext, token)

    expect(Object.keys(claims ?? {}).sort()).toEqual([
      "aud",
      "exp",
      "iat",
      "iss",
      "role",
      "sub",
      "type"
    ])
  })
})

describe("verifyToken", () => {
  it("rejects a token signed by a different key", async () => {
    const other = await generateTestKeys("RS256")
    const otherKey = await importSigningKey(
      other.privateKeyPem,
      "RS256",
      "main"
    )
    const token = await signToken(
      { ...signContext, signingKey: otherKey.signingKey },
      { userId: "user-1" }
    )

    await expect(verifyToken(verifyContext, token)).resolves.toBeNull()
  })

  it("rejects algorithm confusion — an HS256 token keyed with the public key", async () => {
    const publicKeyBytes = new TextEncoder().encode(publicKeyPem)
    const forged = await new SignJWT({ sub: "attacker", role: "authenticated" })
      .setProtectedHeader({ alg: "HS256", kid: "main" })
      .setIssuedAt()
      .setExpirationTime("10m")
      .setIssuer("https://app.example.com/api/auth")
      .setAudience("authenticated")
      .sign(publicKeyBytes)

    await expect(verifyToken(verifyContext, forged)).resolves.toBeNull()
  })

  it("rejects the wrong audience", async () => {
    const token = await signToken(
      { ...signContext, audience: "someone-else" },
      { userId: "user-1" }
    )
    await expect(verifyToken(verifyContext, token)).resolves.toBeNull()
  })

  it("rejects the wrong issuer", async () => {
    const token = await signToken(
      { ...signContext, issuer: "https://evil.example" },
      { userId: "user-1" }
    )
    await expect(verifyToken(verifyContext, token)).resolves.toBeNull()
  })

  it("rejects a token expired beyond the clock tolerance", async () => {
    const token = await signToken(
      { ...signContext, ttl: "-120s" },
      { userId: "user-1" }
    )
    await expect(verifyToken(verifyContext, token)).resolves.toBeNull()
  })

  it("accepts a token inside the 60s skew tolerance", async () => {
    const token = await signToken(
      { ...signContext, ttl: "-30s" },
      { userId: "user-1" }
    )
    await expect(verifyToken(verifyContext, token)).resolves.not.toBeNull()
  })

  it("rejects malformed input", async () => {
    await expect(verifyToken(verifyContext, "not-a-jwt")).resolves.toBeNull()
    await expect(verifyToken(verifyContext, "")).resolves.toBeNull()
  })

  it("enforces no audience constraint when none is configured", async () => {
    const token = await signToken(
      { ...signContext, audience: "anything" },
      { userId: "user-1" }
    )
    const claims = await verifyToken(
      { ...verifyContext, audience: undefined },
      token
    )

    expect(claims?.sub).toBe("user-1")
  })

  it("rejects a correctly signed token that omits exp or iat", async () => {
    // jose checks an expiry it finds and is silent about one it does not, so a
    // token minted elsewhere that leaves `exp` out would otherwise verify and
    // never expire. `TokenClaims` types both as required; this is what makes
    // that true.
    const base = () =>
      new SignJWT({ sub: "user-1" })
        .setProtectedHeader({ alg: "RS256", kid: "main" })
        .setIssuer("https://app.example.com/api/auth")
        .setAudience("authenticated")
    const noExp = await base().setIssuedAt().sign(signContext.signingKey)
    const noIat = await base()
      .setExpirationTime("10m")
      .sign(signContext.signingKey)
    const both = await base()
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(signContext.signingKey)

    await expect(verifyToken(verifyContext, noExp)).resolves.toBeNull()
    await expect(verifyToken(verifyContext, noIat)).resolves.toBeNull()
    // And the same token with both present is fine — it is the absence that fails.
    expect((await verifyToken(verifyContext, both))?.sub).toBe("user-1")
  })
})

describe("ES256", () => {
  it("signs and verifies end to end", async () => {
    const keys = await generateTestKeys("ES256")
    const { signingKey, verificationKey, publicJwk } = await importSigningKey(
      keys.privateKeyPem,
      "ES256",
      "main"
    )

    const token = await signToken(
      {
        signingKey,
        algorithm: "ES256",
        kid: "main",
        ttl: "10m",
        claims: { role: "authenticated" }
      },
      { userId: "user-1" }
    )
    const claims = await verifyToken(
      { verificationKey, algorithm: "ES256" },
      token
    )

    expect(claims?.sub).toBe("user-1")
    expect(publicJwk.kty).toBe("EC")
    expect(publicJwk.crv).toBe("P-256")
  })
})

describe("buildJwks", () => {
  it("publishes only public material", async () => {
    const keys = await generateTestKeys("RS256")
    const { publicJwk } = await importSigningKey(
      keys.privateKeyPem,
      "RS256",
      "main"
    )
    const jwks = buildJwks(publicJwk)

    expect(jwks.keys).toHaveLength(1)
    expect(jwks.keys[0]).toMatchObject({
      kty: "RSA",
      use: "sig",
      alg: "RS256",
      kid: "main"
    })
    for (const privateComponent of ["d", "p", "q", "dp", "dq", "qi"]) {
      expect(jwks.keys[0]).not.toHaveProperty(privateComponent)
    }
  })

  it("publishes rotation keys alongside the signing key, each with a thumbprint kid", async () => {
    const current = await generateTestKeys("RS256")
    const next = await generateTestKeys("RS256")
    const { publicJwk } = await importSigningKey(
      current.privateKeyPem,
      "RS256",
      "main"
    )
    const additional = await importAdditionalPublicKey(
      next.publicKeyPem,
      "RS256"
    )
    const jwks = buildJwks(publicJwk, [additional])

    expect(jwks.keys).toHaveLength(2)
    expect(jwks.keys[0]?.kid).toBe("main")
    expect(jwks.keys[1]?.kid).toBeTruthy()
    expect(jwks.keys[1]?.kid).not.toBe("main")
    await expect(importSPKI(next.publicKeyPem, "RS256")).resolves.toBeDefined()
  })
})

describe("decodeToken", () => {
  it("returns claims for a token with an invalid signature, proving it must never gate access", async () => {
    const token = await signToken(signContext, { userId: "user-1" })
    const [header, payload] = token.split(".")
    const tampered = `${header}.${payload}.deadbeef`

    expect(await verifyToken(verifyContext, tampered)).toBeNull()
    expect(decodeToken(tampered)?.claims.sub).toBe("user-1")
  })

  it("reports expiry without verifying anything", async () => {
    const live = await signToken(signContext, { userId: "user-1" })
    const dead = await signToken(
      { ...signContext, ttl: "-120s" },
      { userId: "user-1" }
    )

    expect(decodeToken(live)?.expired).toBe(false)
    expect(decodeToken(dead)?.expired).toBe(true)
  })

  it("returns null for malformed input", () => {
    expect(decodeToken("not-a-jwt")).toBeNull()
    expect(decodeToken("")).toBeNull()
  })

  it("decodes a token with no exp as present and not expired, rather than lying about it", async () => {
    // A well-formed JWT may omit `exp`. Decoding is unverified, so the answer is
    // what the token says — `exp` absent, not expired — not null, and not a
    // fabricated number. The type says so too: `claims.exp` is optional here.
    const noExp = await new SignJWT({ sub: "user-1" })
      .setProtectedHeader({ alg: "RS256", kid: "main" })
      .setIssuedAt()
      .sign(signContext.signingKey)

    const decoded = decodeToken(noExp)
    expect(decoded).not.toBeNull()
    expect(decoded?.claims.sub).toBe("user-1")
    expect(decoded?.claims.exp).toBeUndefined()
    expect(decoded?.expired).toBe(false)
  })
})
