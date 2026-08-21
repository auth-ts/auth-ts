import { describe, expect, it } from "vitest"
import {
  parseDuration,
  parseDurationSeconds
} from "../../src/lib/parse-duration.ts"

describe("parseDuration", () => {
  it("parses every documented default", () => {
    expect(parseDuration("10m")).toBe(600_000)
    expect(parseDuration("30d")).toBe(2_592_000_000)
    expect(parseDuration("60s")).toBe(60_000)
    expect(parseDuration("15m")).toBe(900_000)
    expect(parseDuration("0s")).toBe(0)
  })

  it("accepts spaces, plurals, and abbreviations", () => {
    expect(parseDuration("30 days")).toBe(parseDuration("30d"))
    expect(parseDuration("2 hours")).toBe(parseDuration("2h"))
    expect(parseDuration("1 minute")).toBe(parseDuration("1m"))
    expect(parseDuration("5 secs")).toBe(parseDuration("5s"))
    expect(parseDuration("1 hr")).toBe(parseDuration("1h"))
  })

  it("is case insensitive and tolerates surrounding whitespace", () => {
    expect(parseDuration("  10M  ")).toBe(600_000)
  })

  it("treats a year as 365.25 days, matching jose", () => {
    expect(parseDuration("1y")).toBe(365.25 * 24 * 60 * 60 * 1000)
  })

  it("rejects unparseable values rather than defaulting", () => {
    expect(() => parseDuration("soon")).toThrow(TypeError)
    expect(() => parseDuration("10")).toThrow(TypeError)
    expect(() => parseDuration("")).toThrow(TypeError)
  })

  it("rejects months, whose length is ambiguous", () => {
    expect(() => parseDuration("1 month")).toThrow(/Months are not supported/)
  })

  it("converts to whole seconds for Max-Age and Retry-After", () => {
    expect(parseDurationSeconds("90s")).toBe(90)
    expect(parseDurationSeconds("1.5s")).toBe(1)
  })
})
