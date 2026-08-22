import { describe, expect, it } from "vitest"
import { parseCookies, readCookie } from "../../src/lib/parse-cookies"
import {
  clearCookie,
  serializeCookie,
  shouldUseSecureCookies
} from "../../src/lib/serialize-cookie"

describe("parseCookies", () => {
  it("parses a multi-cookie header", () => {
    const cookies = parseCookies("a=1; b=two; c=three")
    expect(cookies.get("a")).toBe("1")
    expect(cookies.get("b")).toBe("two")
    expect(cookies.get("c")).toBe("three")
  })

  it("returns empty for absent or blank headers", () => {
    expect(parseCookies(null).size).toBe(0)
    expect(parseCookies(undefined).size).toBe(0)
    expect(parseCookies("").size).toBe(0)
  })

  it("percent-decodes values, round-tripping serializeCookie", () => {
    const setCookie = serializeCookie({
      name: "auth-ts.accounts",
      value: '["a","b"]',
      path: "/api/auth"
    })
    const value = setCookie.slice(
      setCookie.indexOf("=") + 1,
      setCookie.indexOf(";")
    )
    expect(
      parseCookies(`auth-ts.accounts=${value}`).get("auth-ts.accounts")
    ).toBe('["a","b"]')
  })

  it("skips malformed segments instead of throwing", () => {
    const cookies = parseCookies("garbage; a=1; =2; b=")
    expect(cookies.get("a")).toBe("1")
    expect(cookies.get("b")).toBe("")
    expect(cookies.has("garbage")).toBe(false)
  })

  it("drops a name sent twice with different values rather than guessing", () => {
    // A tossed cookie from a sibling subdomain arrives beside the real one, and
    // the header says nothing about which is which.
    const cookies = parseCookies(
      "auth-ts.refresh=mine; a=1; auth-ts.refresh=theirs"
    )
    expect(cookies.has("auth-ts.refresh")).toBe(false)
    expect(cookies.get("a")).toBe("1")

    // Three copies, and the name stays gone — a later copy cannot resurrect it.
    expect(parseCookies("s=one; s=two; s=one").has("s")).toBe(false)
  })

  it("keeps a name repeated with the same value, which is unambiguous", () => {
    expect(parseCookies("s=same; s=same").get("s")).toBe("same")
    // Equality is on the decoded value, since that is what the caller reads.
    expect(parseCookies("s=a%20b; s=a b").get("s")).toBe("a b")
  })

  it("reads a named cookie off Headers regardless of header case", () => {
    const headers = new Headers({ Cookie: "auth-ts.refresh=abc" })
    expect(readCookie(headers, "auth-ts.refresh")).toBe("abc")
    expect(readCookie(headers, "missing")).toBeUndefined()
  })
})

describe("serializeCookie", () => {
  it("always sets HttpOnly, SameSite=Lax, Secure, and the path", () => {
    const setCookie = serializeCookie({
      name: "auth-ts.refresh",
      value: "token",
      path: "/api/auth",
      maxAge: "30d"
    })
    expect(setCookie).toContain("HttpOnly")
    expect(setCookie).toContain("SameSite=Lax")
    expect(setCookie).toContain("Secure")
    expect(setCookie).toContain("Path=/api/auth")
    expect(setCookie).toContain("Max-Age=2592000")
  })

  it("never emits a Domain attribute, keeping the cookie host-only", () => {
    const setCookie = serializeCookie({
      name: "auth-ts.refresh",
      value: "token",
      path: "/"
    })
    expect(setCookie.toLowerCase()).not.toContain("domain")
  })

  it("omits Max-Age when no lifetime is given", () => {
    expect(serializeCookie({ name: "s", value: "v", path: "/" })).not.toContain(
      "Max-Age"
    )
  })

  it("drops Secure only when explicitly relaxed for localhost", () => {
    const setCookie = serializeCookie({
      name: "s",
      value: "v",
      path: "/",
      secure: false
    })
    expect(setCookie).not.toContain("Secure")
    expect(setCookie).toContain("HttpOnly")
  })
})

describe("clearCookie", () => {
  it("expires immediately on the same path it was set with", () => {
    const setCookie = clearCookie("auth-ts.refresh", "/api/auth")
    expect(setCookie).toContain("Max-Age=0")
    expect(setCookie).toContain("Path=/api/auth")
    expect(setCookie).toContain("HttpOnly")
  })
})

describe("shouldUseSecureCookies", () => {
  it("is true for https anywhere", () => {
    expect(shouldUseSecureCookies("https://example.com/api/auth/token")).toBe(
      true
    )
    expect(shouldUseSecureCookies("https://localhost:3000/x")).toBe(true)
  })

  it("is relaxed only for plain-http loopback", () => {
    expect(shouldUseSecureCookies("http://localhost:3000/x")).toBe(false)
    expect(shouldUseSecureCookies("http://127.0.0.1:3000/x")).toBe(false)
    expect(shouldUseSecureCookies("http://example.com/x")).toBe(true)
  })
})
