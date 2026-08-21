import { describe, expect, it } from "vitest"
import {
  hmacSha256Hex,
  sha256Hex,
  timingSafeEqualHex
} from "../../src/lib/hash.ts"

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

describe("hmacSha256Hex", () => {
  it("produces a different digest per secret, so a database leak is not a code leak", async () => {
    const withOneSecret = await hmacSha256Hex("123456", "secret-one")
    const withAnother = await hmacSha256Hex("123456", "secret-two")
    expect(withOneSecret).not.toBe(withAnother)
  })

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
