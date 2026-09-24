import { execFileSync } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createAuth } from "@auth-ts/core"
import { createMemoryDatabase } from "@auth-ts/core/testing"
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from "jose"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { Jwks } from "../src/keygen"
import { keygen } from "../src/keygen"
import { existingEnvNames, writeEnvFile } from "../src/write"

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "auth-ts-keygen-"))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

/** A server configured the way a consumer's would be, from the generated values. */
function serverFor(privateKeyPem: string, alg: "ES256" | "RS256" = "ES256") {
  return createAuth({
    database: createMemoryDatabase(),
    guest: true,
    jwt: { privateKey: privateKeyPem, alg },
    logLevel: "silent"
  })
}

describe("keygen", () => {
  it.each(["RS256", "ES256"] as const)(
    "generates a %s key whose tokens verify against the written jwks.json, as a database would",
    async (algorithm) => {
      const result = await keygen({ algorithm })
      const auth = serverFor(result.privateKeyPem, algorithm)
      const token = await auth.signToken({ userId: "user-1" })

      // The token names the key by the kid the file publishes ...
      expect(decodeProtectedHeader(token).kid).toBe(result.jwks.keys[0]?.kid)
      expect(decodeProtectedHeader(token).alg).toBe(algorithm)

      // ... and a verifier holding only the file accepts it.
      const { payload } = await jwtVerify(token, createLocalJWKSet(result.jwks))
      expect(payload.sub).toBe("user-1")
    }
  )

  it("appends variables an env file does not have", async () => {
    const path = join(directory, ".env")
    await writeFile(path, "EXISTING=1")

    await writeEnvFile(path, { A: '"one"', B: '"two"' })

    // The file had no trailing newline, so the first variable would otherwise
    // have landed on the end of `EXISTING=1`.
    expect(await readFile(path, "utf8")).toBe('EXISTING=1\nA="one"\nB="two"\n')
  })

  it("leaves a variable that is already set unless told to replace it", async () => {
    const path = join(directory, ".env")
    await writeFile(path, 'JWT_PRIVATE_KEY="original"\n')

    expect(await existingEnvNames(path, ["JWT_PRIVATE_KEY", "OTHER"])).toEqual([
      "JWT_PRIVATE_KEY"
    ])

    await writeEnvFile(path, { JWT_PRIVATE_KEY: '"replacement"' })
    expect(await readFile(path, "utf8")).toContain('JWT_PRIVATE_KEY="original"')

    await writeEnvFile(path, { JWT_PRIVATE_KEY: '"replacement"' }, [
      "JWT_PRIVATE_KEY"
    ])
    const after = await readFile(path, "utf8")
    expect(after).toContain('JWT_PRIVATE_KEY="replacement"')
    expect(after).not.toContain("original")
  })

  it("publishes only public key material", async () => {
    const result = await keygen({ algorithm: "RS256" })

    expect(result.jwks.keys).toHaveLength(1)
    expect(result.jwks.keys[0]).toEqual({
      kty: "RSA",
      n: expect.any(String),
      e: "AQAB",
      alg: "RS256",
      use: "sig",
      kid: expect.any(String)
    })
    expect(JSON.stringify(result.jwks)).not.toContain("PRIVATE")
  })

  it("draws a new key every time: the key set belongs to the key", async () => {
    const first = await keygen({ algorithm: "RS256" })
    const second = await keygen({ algorithm: "RS256" })

    expect(second.jwks.keys[0]?.kid).not.toBe(first.jwks.keys[0]?.kid)
  })
})

describe("auth-ts keygen", () => {
  const entry = resolve(import.meta.dirname, "../src/cli.ts")
  const tsconfig = resolve(import.meta.dirname, "../tsconfig.json")

  function run(args: string[]) {
    return execFileSync("tsx", ["--tsconfig", tsconfig, entry, ...args], {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    })
  }

  it("prints both and writes nothing without an answer", async () => {
    const stdout = run(["keygen"])

    expect(stdout).toMatch(
      /^JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n[^"\n]+\\n-----END PRIVATE KEY-----"$/m
    )
    const jwks = stdout.slice(stdout.indexOf("jwks.json") + "jwks.json".length)
    expect(JSON.parse(jwks)).toHaveProperty("keys")
    // Pretty-printed, so it reads rather than only pastes.
    expect(jwks).toContain("\n  ")

    // Nothing to answer the prompt, so nothing is kept.
    await expect(readFile(join(directory, ".env"))).rejects.toThrow()
    await expect(
      readFile(join(directory, "public/jwks.json"))
    ).rejects.toThrow()
  })

  it("keeps both with --yes, and the printed key verifies against the written set", async () => {
    const stdout = run(["keygen", "--yes"])

    const env = await readFile(join(directory, ".env"), "utf8")
    expect(env).toContain("JWT_PRIVATE_KEY=")

    const privateKeyPem = (
      stdout.match(/^JWT_PRIVATE_KEY="(.+)"$/m)?.[1] ?? ""
    ).replace(/\\n/g, "\n")
    const auth = serverFor(privateKeyPem)
    const token = await auth.signToken({ userId: "user-1" })
    const published = JSON.parse(
      await readFile(join(directory, "public/jwks.json"), "utf8")
    ) as Jwks

    await expect(
      jwtVerify(token, createLocalJWKSet(published))
    ).resolves.toBeDefined()
  })

  it("honours --out and --env", async () => {
    run(["keygen", "--yes", "--out", "static", "--env", ".env.local"])

    expect(
      JSON.parse(await readFile(join(directory, "static/jwks.json"), "utf8"))
    ).toHaveProperty("keys")
    expect(await readFile(join(directory, ".env.local"), "utf8")).toContain(
      "JWT_PRIVATE_KEY="
    )
    await expect(readFile(join(directory, ".env"))).rejects.toThrow()
  })

  it("will not replace a key the env file already has, even with --yes", async () => {
    await writeFile(join(directory, ".env"), 'JWT_PRIVATE_KEY="original"\n')

    run(["keygen", "--yes"])

    const env = await readFile(join(directory, ".env"), "utf8")
    expect(env).toContain('JWT_PRIVATE_KEY="original"')
    expect(env).not.toContain("BEGIN PRIVATE KEY")
  })

  it("leaves the key set alone when the env file keeps its own key", async () => {
    // The file belongs to the key. Writing a set for a key the server is not
    // signing with would publish a verifier that rejects every token.
    run(["keygen", "--yes"])
    const first = await readFile(join(directory, "public/jwks.json"), "utf8")

    run(["keygen", "--yes"])

    expect(await readFile(join(directory, "public/jwks.json"), "utf8")).toBe(
      first
    )
  })

  it("takes the algorithm in any case", () => {
    expect(run(["keygen", "--alg", "es256"])).toContain('"alg": "ES256"')
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
    await expect(readFile(join(directory, "jwks.json"))).rejects.toThrow()
  })

  it("prints usage with no command", () => {
    expect(run([])).toMatch(/^Usage: npx @auth-ts\/cli <command>/)
  })
})
