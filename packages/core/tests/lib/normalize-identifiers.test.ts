import { describe, expect, it } from "vitest"
import {
  normalizePhone,
  verifyAccountIdentifierEmailAddressPattern
} from "../../src/lib/normalize-identifiers"

describe("verifyAccountIdentifierEmailAddressPattern", () => {
  const verify = verifyAccountIdentifierEmailAddressPattern

  it("accepts the book's shape and nothing looser", () => {
    for (const email of [
      "ada@example.com",
      "ada.lovelace+notes_1-2@sub-domain.example.co",
      "a@b.c",
      `${"a".repeat(100 - "@example.com".length)}@example.com`
    ]) {
      expect(verify(email), email).toBe(true)
    }
  })

  it("refuses rather than repairs", () => {
    for (const email of [
      "Ada@example.com",
      "ada@Example.com",
      " ada@example.com",
      "ada@example.com ",
      "ada",
      "ada@",
      "@example.com",
      "ada@@example.com",
      "ada@example",
      "ada@.example.com",
      "ada@example.com.",
      "ada lovelace@example.com",
      '"ada"@example.com',
      "ada@exämple.com",
      "adä@example.com",
      `${"a".repeat(101 - "@example.com".length)}@example.com`
    ]) {
      expect(verify(email), email).toBe(false)
    }
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
