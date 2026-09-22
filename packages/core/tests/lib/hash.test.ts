import { describe, expect, it, vi } from "vitest"
import {
  hmacSha256Hex,
  scryptDerive,
  scryptHash,
  scryptVerify,
  sha256Hex,
  timingSafeEqualHex
} from "../../src/lib/hash"

describe("hmacSha256Hex key reuse", () => {
  it("imports the key once per secret rather than once per call", async () => {
    const importKey = vi.spyOn(crypto.subtle, "importKey")
    const secret = `memo-secret-${Math.random()}`

    const first = await hmacSha256Hex("one", secret)
    const second = await hmacSha256Hex("two", secret)
    await hmacSha256Hex("three", `${secret}-other`)

    expect(first).not.toBe(second)
    expect(importKey).toHaveBeenCalledTimes(2)
    importKey.mockRestore()
  })
})

describe("sha256Hex", () => {
  it("matches the known digest of the empty string", async () => {
    await expect(sha256Hex("")).resolves.toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    )
  })

  it("is deterministic and 64 hex characters", async () => {
    const first = await sha256Hex("refresh-token")
    const second = await sha256Hex("refresh-token")
    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe("scrypt", () => {
  it("matches the RFC 7914 test vector", async () => {
    // Section 12, second vector: ("password", "NaCl", N=1024, r=8, p=16).
    const key = await scryptDerive(
      "password",
      new TextEncoder().encode("NaCl"),
      { ln: 10, r: 8, p: 16 },
      64
    )
    expect(Buffer.from(key).toString("hex")).toBe(
      "fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640"
    )
  })

  it("stores the parameters and a fresh salt in the string, and nothing of the code", async () => {
    const first = await scryptHash("ABC123")
    const second = await scryptHash("ABC123")
    expect(first).toMatch(
      /^\$scrypt\$ln=14,r=8,p=1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/
    )
    expect(first).not.toBe(second)
    expect(first).not.toContain("ABC123")
  })

  it("verifies the code it was made from and nothing else", async () => {
    const stored = await scryptHash("ABC123")
    await expect(scryptVerify("ABC123", stored)).resolves.toBe(true)
    await expect(scryptVerify("ABC124", stored)).resolves.toBe(false)
    await expect(scryptVerify("ABC123", "not-a-hash")).resolves.toBe(false)
    await expect(
      scryptVerify("ABC123", "$scrypt$ln=14,r=8,p=1$!!$!!")
    ).resolves.toBe(false)
  })

  it("reads the cost from the string, so it can be raised without a migration", async () => {
    // A row written at a lighter cost still verifies after the default moves.
    const salt = new Uint8Array(16)
    const key = await scryptDerive("ABC123", salt, { ln: 10, r: 8, p: 1 }, 32)
    const encode = (bytes: Uint8Array) =>
      Buffer.from(bytes).toString("base64url")
    const stored = `$scrypt$ln=10,r=8,p=1$${encode(salt)}$${encode(key)}`

    await expect(scryptVerify("ABC123", stored)).resolves.toBe(true)
    await expect(scryptVerify("ABC124", stored)).resolves.toBe(false)
  })
})

describe("hmacSha256Hex", () => {
  it("matches the RFC 4231 test vector", async () => {
    const digest = await hmacSha256Hex("Hi There", "\x0b".repeat(20))
    expect(digest).toBe(
      "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
    )
  })
})

describe("timingSafeEqualHex", () => {
  it("compares equal and unequal digests correctly", () => {
    expect(timingSafeEqualHex("abcd", "abcd")).toBe(true)
    expect(timingSafeEqualHex("abcd", "abce")).toBe(false)
    expect(timingSafeEqualHex("abcd", "abcde")).toBe(false)
    expect(timingSafeEqualHex("", "")).toBe(true)
  })
})
