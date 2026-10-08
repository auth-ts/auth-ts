import { describe, expect, it } from "vitest"
import {
  CODE_ALPHABETS,
  randomBytesBase64url,
  randomCode
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

describe("randomCode", () => {
  it("draws every symbol from the alphabet, at the requested length", () => {
    for (const alphabet of ["alphanumeric", "numeric"] as const) {
      const symbols = CODE_ALPHABETS[alphabet]
      for (const length of [6, 8, 12]) {
        const code = randomCode(alphabet, length)
        expect(code).toHaveLength(length)
        for (const symbol of code) expect(symbols).toContain(symbol)
      }
    }
  })

  it("leaves out the symbols people misread", () => {
    expect(CODE_ALPHABETS.alphanumeric).toHaveLength(32)
    for (const confusable of ["I", "O", "0", "1"]) {
      expect(CODE_ALPHABETS.alphanumeric).not.toContain(confusable)
    }
  })

  it("reaches every symbol without obvious bias", () => {
    // Masking a byte to the alphabet's width and rejecting the overflow keeps
    // every symbol equally likely; a modulo would favour the first few.
    for (const alphabet of ["alphanumeric", "numeric"] as const) {
      const symbols = CODE_ALPHABETS[alphabet]
      const seen = new Map<string, number>()
      for (let draw = 0; draw < 500; draw++) {
        for (const symbol of randomCode(alphabet, 12)) {
          seen.set(symbol, (seen.get(symbol) ?? 0) + 1)
        }
      }
      expect(seen.size).toBe(symbols.length)
      const expected = 6000 / symbols.length
      for (const count of seen.values()) {
        expect(count).toBeGreaterThan(expected * 0.6)
        expect(count).toBeLessThan(expected * 1.4)
      }
    }
  })
})
