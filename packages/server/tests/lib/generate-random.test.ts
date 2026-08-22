import { describe, expect, it } from "vitest"
import {
  randomBytesBase64url,
  randomSixDigitCode
} from "../../src/lib/generate-random"

describe("randomBytesBase64url", () => {
  it("emits url-safe characters only, with no padding", () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      expect(randomBytesBase64url(32)).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  it("encodes 32 bytes as 43 characters", () => {
    expect(randomBytesBase64url(32)).toHaveLength(43)
  })

  it("does not repeat across draws", () => {
    const draws = new Set(
      Array.from({ length: 200 }, () => randomBytesBase64url(32))
    )
    expect(draws.size).toBe(200)
  })
})

describe("randomSixDigitCode", () => {
  it("is always exactly six digits, including leading zeros", () => {
    for (let attempt = 0; attempt < 500; attempt++) {
      expect(randomSixDigitCode()).toMatch(/^\d{6}$/)
    }
  })

  it("covers the whole range without obvious bias", () => {
    const codes = Array.from({ length: 2000 }, () =>
      Number(randomSixDigitCode())
    )
    const belowHalf = codes.filter((code) => code < 500_000).length
    // A modulo-biased generator skews low; 2000 draws should land near an even split.
    expect(belowHalf).toBeGreaterThan(850)
    expect(belowHalf).toBeLessThan(1150)
  })
})
