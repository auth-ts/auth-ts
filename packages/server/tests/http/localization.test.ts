import { describe, expect, it } from "vitest"
import {
  builtInErrorMessages,
  getErrorMessage
} from "../../src/http/get-error-message.ts"
import { resolveLocale } from "../../src/http/resolve-locale.ts"

const localization = {
  defaultLocale: "en",
  messages: {
    de: {
      invalidCode: "Dieser Code ist ungültig.",
      cooldown: "Bitte warte {retryAfter} Sekunden."
    }
  }
}

describe("getErrorMessage", () => {
  it("ships a non-empty English message for every code", () => {
    for (const [code, message] of Object.entries(builtInErrorMessages)) {
      expect(message.length, code).toBeGreaterThan(0)
    }
  })

  it("uses a configured override when the locale matches", () => {
    expect(getErrorMessage("invalidCode", "de", localization)).toBe(
      "Dieser Code ist ungültig."
    )
  })

  it("falls through per key, so a partial overlay never yields a blank", () => {
    expect(getErrorMessage("notFound", "de", localization)).toBe(
      builtInErrorMessages.notFound
    )
  })

  it("falls back to the built-in message for an unknown locale", () => {
    expect(getErrorMessage("invalidCode", "fr", localization)).toBe(
      builtInErrorMessages.invalidCode
    )
  })

  it("interpolates retryAfter in both built-in and overridden messages", () => {
    expect(
      getErrorMessage("cooldown", "en", localization, { retryAfter: 42 })
    ).toContain("42")
    expect(
      getErrorMessage("cooldown", "de", localization, { retryAfter: 42 })
    ).toBe("Bitte warte 42 Sekunden.")
  })

  it("never leaks identifiers, because messages take no identifier input", () => {
    for (const message of Object.values(builtInErrorMessages)) {
      expect(message).not.toMatch(/@/)
    }
  })
})

describe("resolveLocale", () => {
  it("returns the default when no header is sent", () => {
    expect(resolveLocale(null, localization)).toBe("en")
  })

  it("matches a configured locale exactly", () => {
    expect(resolveLocale("de", localization)).toBe("de")
  })

  it("matches on the language subtag, so de-AT finds de", () => {
    expect(resolveLocale("de-AT", localization)).toBe("de")
  })

  it("honours quality ordering rather than header order", () => {
    expect(resolveLocale("fr;q=0.9, de;q=1.0", localization)).toBe("de")
  })

  it("falls back to the default for locales with no overlay", () => {
    expect(resolveLocale("ja", localization)).toBe("en")
  })

  it("ignores the wildcard and zero-quality entries", () => {
    expect(resolveLocale("*", localization)).toBe("en")
    expect(resolveLocale("de;q=0", localization)).toBe("en")
  })
})
