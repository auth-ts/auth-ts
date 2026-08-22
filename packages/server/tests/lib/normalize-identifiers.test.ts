import { describe, expect, it } from "vitest"
import {
  looksLikeEmail,
  normalizeEmail,
  normalizePhone
} from "../../src/lib/normalize-identifiers"

describe("normalizeEmail", () => {
  it("collapses case and trims, so one person is one account", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com")
  })
})

describe("normalizePhone", () => {
  it("strips the separators people actually type", () => {
    expect(normalizePhone("+1 (555) 123-4567")).toBe("+15551234567")
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958")
  })

  it("requires a leading + rather than guessing a country", () => {
    expect(() => normalizePhone("5551234567")).toThrow(TypeError)
  })

  it("rejects values that are not plausibly dialable", () => {
    expect(() => normalizePhone("+123")).toThrow(TypeError)
    expect(() => normalizePhone("+1234567890123456")).toThrow(TypeError)
    expect(() => normalizePhone("+1555abc4567")).toThrow(TypeError)
  })
})

describe("looksLikeEmail", () => {
  it("distinguishes emails from phone numbers", () => {
    expect(looksLikeEmail("ada@example.com")).toBe(true)
    expect(looksLikeEmail("+15551234567")).toBe(false)
  })
})
