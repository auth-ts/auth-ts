import { describe, expect, it } from "vitest"
import { validateRedirect } from "../../src/lib/validate-redirect"

describe("validateRedirect", () => {
  it("keeps same-origin relative paths", () => {
    expect(validateRedirect("/dashboard")).toBe("/dashboard")
    expect(validateRedirect("/a/b?c=d#e")).toBe("/a/b?c=d#e")
  })

  it("falls back to / when absent", () => {
    expect(validateRedirect(null)).toBe("/")
    expect(validateRedirect(undefined)).toBe("/")
    expect(validateRedirect("")).toBe("/")
  })

  it("rejects absolute urls", () => {
    expect(validateRedirect("https://evil.example/steal")).toBe("/")
    expect(validateRedirect("javascript:alert(1)")).toBe("/")
    expect(validateRedirect("HTTPS://evil.example")).toBe("/")
  })

  it("rejects protocol-relative urls, which browsers treat as absolute", () => {
    expect(validateRedirect("//evil.example/steal")).toBe("/")
  })

  it("rejects control characters the URL parser would strip, which smuggle a host", () => {
    // "/\t/evil.com" passes a naive "//" check, then the parser drops the tab
    // and the browser is sent to evil.com. Tab, newline, and carriage return are
    // the three the WHATWG parser strips; the whole C0 range and DEL are refused.
    for (const smuggled of [
      "/\t/evil.com",
      "/\n/evil.com",
      "/\r/evil.com",
      "/\u0000/evil.com",
      "/\u007f/evil.com"
    ]) {
      expect(validateRedirect(smuggled)).toBe("/")
    }
  })

  it("rejects backslash tricks", () => {
    expect(validateRedirect("/\\evil.example")).toBe("/")
  })

  it("narrows further when an allowlist is configured", () => {
    expect(validateRedirect("/dashboard", ["/dashboard"])).toBe("/dashboard")
    expect(validateRedirect("/secret", ["/dashboard"])).toBe("/")
  })
})
