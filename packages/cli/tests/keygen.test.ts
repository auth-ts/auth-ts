import { execFileSync } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createAuthServer } from "@auth-ts/server"
import { createMemoryDb } from "@auth-ts/server/testing"
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
      const result = await keygen({ algorithm })
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
    await writeFile(path, 'AUTH_SECRET="original"\n')

    expect(
      await existingEnvNames(path, ["AUTH_SECRET", "JWT_PRIVATE_KEY"])
    ).toEqual(["AUTH_SECRET"])

    await writeEnvFile(path, { AUTH_SECRET: '"replacement"' })
    expect(await readFile(path, "utf8")).toContain('AUTH_SECRET="original"')

    await writeEnvFile(path, { AUTH_SECRET: '"replacement"' }, ["AUTH_SECRET"])
    const after = await readFile(path, "utf8")
    expect(after).toContain('AUTH_SECRET="replacement"')
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

  it("draws a 32-byte base64 secret, distinct from the key", async () => {
    const result = await keygen({ algorithm: "RS256" })

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

  it("prints all three and writes nothing without an answer", async () => {
    const stdout = run(["keygen"])

    const [privateKey, secret] = stdout.split("\n")
    expect(privateKey).toMatch(
      /^JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n[^"\n]+\\n-----END PRIVATE KEY-----"$/
    )
    expect(secret).toMatch(/^AUTH_SECRET="[A-Za-z0-9+/]{43}="$/)
    const jwks = stdout.slice(stdout.indexOf("JWKS=") + "JWKS=".length)
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
    expect(env).toContain("AUTH_SECRET=")

    const privateKeyPem = stdout
      .slice('JWT_PRIVATE_KEY="'.length, stdout.indexOf('"\nAUTH_SECRET'))
      .replace(/\\n/g, "\n")
    const secret = env.match(/^AUTH_SECRET="(.+)"$/m)?.[1]
    const authServer = serverFor(privateKeyPem, secret ?? "")
    const token = await authServer.signToken({ userId: "user-1" })
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
      "AUTH_SECRET="
    )
    await expect(readFile(join(directory, ".env"))).rejects.toThrow()
  })

  it("will not replace a secret the env file already has, even with --yes", async () => {
    await writeFile(join(directory, ".env"), 'AUTH_SECRET="original"\n')

    run(["keygen", "--yes"])

    const env = await readFile(join(directory, ".env"), "utf8")
    expect(env).toContain('AUTH_SECRET="original"')
    expect(env).toContain("JWT_PRIVATE_KEY=")
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
    expect(run([])).toMatch(/^Usage: bun x @auth-ts\/cli <command>/)
  })
})
