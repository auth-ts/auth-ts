import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { parseEnv } from "node:util"
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

const assignmentFixtures = [
  {
    name: "plain",
    source: 'JWT_PRIVATE_KEY="original"\n',
    replaced: 'JWT_PRIVATE_KEY="replacement"\n'
  },
  {
    name: "export",
    source: 'export JWT_PRIVATE_KEY="original"\n',
    replaced: 'export JWT_PRIVATE_KEY="replacement"\n'
  },
  {
    name: "indentation",
    source: '\t  JWT_PRIVATE_KEY="original"\n',
    replaced: '\t  JWT_PRIVATE_KEY="replacement"\n'
  },
  {
    name: "spacing",
    source: 'JWT_PRIVATE_KEY \t=  "original"\n',
    replaced: 'JWT_PRIVATE_KEY \t=  "replacement"\n'
  },
  {
    name: "combined formatting and CRLF",
    source: '\t export JWT_PRIVATE_KEY = "original" # old key\r\n',
    replaced: '\t export JWT_PRIVATE_KEY = "replacement"\r\n'
  },
  {
    name: "multiline double quotes",
    source: 'export JWT_PRIVATE_KEY="first\nsecond"\n',
    replaced: 'export JWT_PRIVATE_KEY="replacement"\n'
  },
  {
    name: "multiline single quotes",
    source: "JWT_PRIVATE_KEY='first\nsecond'\n",
    replaced: 'JWT_PRIVATE_KEY="replacement"\n'
  },
  {
    name: "multiline backticks",
    source: "JWT_PRIVATE_KEY=`first\nsecond`\n",
    replaced: 'JWT_PRIVATE_KEY="replacement"\n'
  },
  {
    name: "duplicates",
    source: 'JWT_PRIVATE_KEY="first"\r\nexport JWT_PRIVATE_KEY = "second"\r\n',
    replaced:
      'JWT_PRIVATE_KEY="replacement"\r\nexport JWT_PRIVATE_KEY = "replacement"\r\n'
  },
  {
    name: "empty assignment",
    source: "JWT_PRIVATE_KEY=\n",
    replaced: 'JWT_PRIVATE_KEY="replacement"\n'
  }
]

describe("env assignments", () => {
  it.each(assignmentFixtures)(
    "preserves $name without replacement approval",
    async ({ source }) => {
      const path = join(directory, "keys.fixture")
      const original = `OTHER="keep"\n# keep this comment\n${source}LAST=keep\n`
      await writeFile(path, original)

      expect(Object.hasOwn(parseEnv(original), "JWT_PRIVATE_KEY")).toBe(true)
      expect(
        await existingEnvNames(path, ["JWT_PRIVATE_KEY", "OTHER", "MISSING"])
      ).toEqual(["JWT_PRIVATE_KEY", "OTHER"])
      await writeEnvFile(path, { JWT_PRIVATE_KEY: '"replacement"' })
      expect(await readFile(path, "utf8")).toBe(original)
    }
  )

  it.each(assignmentFixtures)(
    "replaces every $name assignment when approved",
    async ({ source, replaced }) => {
      const path = join(directory, "keys.fixture")
      const before = 'OTHER="keep"\n# keep this comment\n'
      const after = "LAST=keep\n"
      await writeFile(path, before + source + after)

      await writeEnvFile(path, { JWT_PRIVATE_KEY: '"replacement"' }, [
        "JWT_PRIVATE_KEY"
      ])
      const contents = await readFile(path, "utf8")
      expect(contents).toBe(before + replaced + after)
      expect(parseEnv(contents).JWT_PRIVATE_KEY).toBe("replacement")
    }
  )

  it.each([
    '# JWT_PRIVATE_KEY="original"\n',
    'JWT_PRIVATE_KEY_OLD="original"\n',
    'OTHER="first\nJWT_PRIVATE_KEY=original\nlast"\n',
    "OTHER='first\nJWT_PRIVATE_KEY=original\nlast'\n",
    "OTHER=`first\nJWT_PRIVATE_KEY=original\nlast`\n",
    'OTHER.CONFIG="first\nJWT_PRIVATE_KEY=original\nlast"\n'
  ])(
    "ignores assignment-looking text outside a key assignment: %j",
    async (source) => {
      const path = join(directory, "keys.fixture")
      await writeFile(path, source)

      expect(Object.hasOwn(parseEnv(source), "JWT_PRIVATE_KEY")).toBe(false)
      expect(await existingEnvNames(path, ["JWT_PRIVATE_KEY"])).toEqual([])
      await writeEnvFile(path, { JWT_PRIVATE_KEY: '"replacement"' }, [
        "JWT_PRIVATE_KEY"
      ])
      const contents = await readFile(path, "utf8")
      expect(contents).toBe(`${source}JWT_PRIVATE_KEY="replacement"\n`)
      expect(parseEnv(contents).JWT_PRIVATE_KEY).toBe("replacement")
    }
  )

  it("compares variable names literally", async () => {
    const path = join(directory, "keys.fixture")
    const source = 'AUTHxKEY="keep"\nAUTH.KEY="original"\n'
    await writeFile(path, source)

    expect(
      await existingEnvNames(path, ["AUTH.KEY", "AUTHxKEY", "AUTH-KEY"])
    ).toEqual(["AUTH.KEY", "AUTHxKEY"])
    await writeEnvFile(path, { "AUTH.KEY": '"replacement"' }, ["AUTH.KEY"])
    expect(await readFile(path, "utf8")).toBe(
      'AUTHxKEY="keep"\nAUTH.KEY="replacement"\n'
    )
  })

  it("creates a missing file", async () => {
    const path = join(directory, "missing.fixture")
    expect(await existingEnvNames(path, ["JWT_PRIVATE_KEY"])).toEqual([])
    expect(await writeEnvFile(path, { JWT_PRIVATE_KEY: '"replacement"' })).toBe(
      path
    )
    expect(await readFile(path, "utf8")).toBe('JWT_PRIVATE_KEY="replacement"\n')
  })

  it("propagates non-missing read errors", async () => {
    const path = join(directory, "unreadable.fixture")
    await mkdir(path)

    await expect(
      existingEnvNames(path, ["JWT_PRIVATE_KEY"])
    ).rejects.toMatchObject({ code: "EISDIR" })
    await expect(
      writeEnvFile(path, { JWT_PRIVATE_KEY: '"replacement"' })
    ).rejects.toMatchObject({ code: "EISDIR" })
    const prefix = join(directory, "file.fixture")
    await writeFile(prefix, "keep")
    await expect(
      existingEnvNames(join(prefix, "child.fixture"), ["JWT_PRIVATE_KEY"])
    ).rejects.toMatchObject({ code: "ENOTDIR" })
    expect(await readFile(prefix, "utf8")).toBe("keep")
  })
})

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
    const path = join(directory, "keys.fixture")
    await writeFile(path, "EXISTING=1")

    await writeEnvFile(path, { A: '"one"', B: '"two"' })

    // The file had no trailing newline, so the first variable would otherwise
    // have landed on the end of `EXISTING=1`.
    expect(await readFile(path, "utf8")).toBe('EXISTING=1\nA="one"\nB="two"\n')
  })

  it("leaves a variable that is already set unless told to replace it", async () => {
    const path = join(directory, "keys.fixture")
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
    const command =
      args[0] === "keygen" && !args.includes("--env")
        ? [...args, "--env", "keys.fixture"]
        : args
    return execFileSync("tsx", ["--tsconfig", tsconfig, entry, ...command], {
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
    await expect(readFile(join(directory, "keys.fixture"))).rejects.toThrow()
    await expect(
      readFile(join(directory, "public/jwks.json"))
    ).rejects.toThrow()
  })

  it("keeps both with --yes, and the printed key verifies against the written set", async () => {
    const stdout = run(["keygen", "--yes"])

    const env = await readFile(join(directory, "keys.fixture"), "utf8")
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
    run(["keygen", "--yes", "--out", "static", "--env", "custom.fixture"])

    expect(
      JSON.parse(await readFile(join(directory, "static/jwks.json"), "utf8"))
    ).toHaveProperty("keys")
    expect(await readFile(join(directory, "custom.fixture"), "utf8")).toContain(
      "JWT_PRIVATE_KEY="
    )
    await expect(readFile(join(directory, "keys.fixture"))).rejects.toThrow()
  })

  it("will not replace a key the env file already has, even with --yes", async () => {
    await writeFile(
      join(directory, "keys.fixture"),
      'JWT_PRIVATE_KEY="original"\n'
    )

    run(["keygen", "--yes"])

    const env = await readFile(join(directory, "keys.fixture"), "utf8")
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

  it.each(assignmentFixtures)(
    "keeps both files with --yes for $name",
    async ({ source }) => {
      const path = join(directory, "keys.fixture")
      const original = `OTHER=keep\n${source}`
      await writeFile(path, original)
      await mkdir(join(directory, "public"))
      const jwksPath = join(directory, "public/jwks.json")
      const published = '{"keys":[]}\n'
      await writeFile(jwksPath, published)

      run(["keygen", "--yes"])

      expect(await readFile(path, "utf8")).toBe(original)
      expect(await readFile(jwksPath, "utf8")).toBe(published)
    }
  )

  it("keeps a formatted private key matched to its existing JWKS", async () => {
    const initial = run(["keygen", "--yes"])
    const quoted = initial.match(/^JWT_PRIVATE_KEY=(".+")$/m)?.[1]
    expect(quoted).toBeDefined()
    const path = join(directory, "keys.fixture")
    const formatted = `  export JWT_PRIVATE_KEY = ${quoted}\n`
    await writeFile(path, formatted)
    const jwksPath = join(directory, "public/jwks.json")
    const originalJwks = await readFile(jwksPath, "utf8")
    const privateKeyPem = (parseEnv(formatted).JWT_PRIVATE_KEY ?? "").replace(
      /\\n/g,
      "\n"
    )
    const token = await serverFor(privateKeyPem).signToken({
      userId: "existing-user"
    })

    run(["keygen", "--yes"])

    expect(await readFile(path, "utf8")).toBe(formatted)
    expect(await readFile(jwksPath, "utf8")).toBe(originalJwks)
    const verified = await jwtVerify(
      token,
      createLocalJWKSet(JSON.parse(originalJwks) as Jwks)
    )
    expect(verified.payload.sub).toBe("existing-user")
  })

  it("does not create a JWKS when an existing formatted key is retained", async () => {
    const path = join(directory, "keys.fixture")
    const original = 'export JWT_PRIVATE_KEY = "original"\n'
    await writeFile(path, original)

    run(["keygen", "--yes"])

    expect(await readFile(path, "utf8")).toBe(original)
    await expect(
      readFile(join(directory, "public/jwks.json"))
    ).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("stops on a read failure before writing the JWKS", async () => {
    const path = join(directory, "unreadable.fixture")
    await mkdir(path)
    await mkdir(join(directory, "public"))
    const jwksPath = join(directory, "public/jwks.json")
    const original = '{"keys":[]}\n'
    await writeFile(jwksPath, original)

    expect(() => run(["keygen", "--yes", "--env", path])).toThrow(/EISDIR/)
    expect(await readFile(jwksPath, "utf8")).toBe(original)
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
