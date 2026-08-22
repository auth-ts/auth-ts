import { execFileSync } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createAuthServer } from "@auth-ts/server"
import { createMemoryDb } from "@auth-ts/server/testing"
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from "jose"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { Jwks } from "../src/keygen"
import { keygen } from "../src/keygen"

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "auth-ts-keygen-"))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

/** A server configured the way a consumer's would be, from the generated values. */
function serverFor(
  privateKeyPem: string,
  secret: string,
  alg: "RS256" | "ES256" = "RS256"
) {
  return createAuthServer({
    db: createMemoryDb(),
    guest: true,
    secret,
    jwt: { privateKey: privateKeyPem, alg },
    logLevel: "silent"
  })
}

describe("keygen", () => {
  it.each(["RS256", "ES256"] as const)(
    "generates a %s key whose tokens verify against the written jwks.json, as a database would",
    async (algorithm) => {
      const result = await keygen({ algorithm, directory })
      const authServer = serverFor(
        result.privateKeyPem,
        result.secret,
        algorithm
      )
      const token = await authServer.signToken({ userId: "user-1" })

      // The token names the key by the kid the file publishes ...
      expect(decodeProtectedHeader(token).kid).toBe(result.jwks.keys[0]?.kid)
      expect(decodeProtectedHeader(token).alg).toBe(algorithm)

      // ... and a verifier holding only the file accepts it.
      const published = JSON.parse(
        await readFile(result.jwksPath, "utf8")
      ) as Jwks
      const { payload } = await jwtVerify(token, createLocalJWKSet(published))
      expect(payload.sub).toBe("user-1")
    }
  )

  it("writes the key set to public/jwks.json, creating the folder", async () => {
    const result = await keygen({ algorithm: "RS256", directory })

    expect(result.jwksPath).toBe(resolve(directory, "public/jwks.json"))
    const written = await readFile(result.jwksPath, "utf8")
    expect(written.endsWith("\n")).toBe(true)
    expect(JSON.parse(written)).toEqual(result.jwks)
  })

  it("publishes only public key material", async () => {
    const result = await keygen({ algorithm: "RS256", directory })

    expect(result.jwks.keys).toHaveLength(1)
    expect(result.jwks.keys[0]).toEqual({
      kty: "RSA",
      n: expect.any(String),
      e: "AQAB",
      alg: "RS256",
      use: "sig",
      kid: expect.any(String)
    })
    expect(await readFile(result.jwksPath, "utf8")).not.toContain("PRIVATE")
  })

  it("replaces a previous jwks.json: the file belongs to the key", async () => {
    const first = await keygen({ algorithm: "RS256", directory })
    const second = await keygen({ algorithm: "RS256", directory })

    expect(JSON.parse(await readFile(second.jwksPath, "utf8"))).toEqual(
      second.jwks
    )
    expect(second.jwks.keys[0]?.kid).not.toBe(first.jwks.keys[0]?.kid)
  })

  it("draws a 32-byte base64 secret, distinct from the key", async () => {
    const result = await keygen({ algorithm: "RS256", directory })

    expect(Buffer.from(result.secret, "base64")).toHaveLength(32)
    expect(result.secret).toMatch(/^[A-Za-z0-9+/]{43}=$/)
    expect(result.secret).not.toBe(result.privateKeyPem)
  })
})

describe("auth-ts keygen", () => {
  const entry = resolve(import.meta.dirname, "../src/cli.ts")

  function run(args: string[]) {
    return execFileSync("bun", [entry, ...args], {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    })
  }

  it("prints exactly the two .env lines and writes public/jwks.json in the working directory", async () => {
    const stdout = run(["keygen"])

    const lines = stdout.trimEnd().split("\n")
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(
      /^JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n[^"\n]+\\n-----END PRIVATE KEY-----"$/
    )
    expect(lines[1]).toMatch(/^AUTH_SECRET="[A-Za-z0-9+/]{43}="$/)

    // The printed value round-trips through the way .env loaders read it, and
    // signs tokens the written file verifies.
    const privateKeyPem = lines[0]
      ?.slice('JWT_PRIVATE_KEY="'.length, -1)
      .replace(/\\n/g, "\n")
    const secret = lines[1]?.slice('AUTH_SECRET="'.length, -1)
    const authServer = serverFor(privateKeyPem ?? "", secret ?? "")
    const token = await authServer.signToken({ userId: "user-1" })
    const published = JSON.parse(
      await readFile(join(directory, "public/jwks.json"), "utf8")
    ) as Jwks
    await expect(
      jwtVerify(token, createLocalJWKSet(published))
    ).resolves.toBeDefined()
  })

  it("accepts --alg ES256", () => {
    const stdout = run(["keygen", "--alg", "ES256"])

    expect(stdout).toMatch(/^JWT_PRIVATE_KEY=/)
  })

  it("rejects an unknown algorithm, command, or flag without writing anything", async () => {
    for (const args of [
      ["keygen", "--alg", "HS256"],
      ["keygen", "--bogus"],
      ["rotate"]
    ]) {
      expect(() => run(args)).toThrow(/Usage:/)
    }
    await expect(
      readFile(join(directory, "public/jwks.json"))
    ).rejects.toThrow()
  })

  it("prints usage with no command", () => {
    expect(run([])).toMatch(/^Usage: bun x @auth-ts\/cli <command>/)
  })
})
