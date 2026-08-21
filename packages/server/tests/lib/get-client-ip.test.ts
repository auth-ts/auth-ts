import { describe, expect, it } from "vitest"
import {
  getClientIp,
  isIpAddress,
  resolveClientIpOptions
} from "../../src/lib/get-client-ip.ts"

const xff = (value: string) => new Headers({ "x-forwarded-for": value })

describe("isIpAddress", () => {
  it("stays strict about wrappers — unwrapping is getClientIp's job, on the trusted entry only", () => {
    for (const wrapped of [
      "[2001:db8::1]",
      "[2001:db8::1]:443",
      "203.0.113.7:54321"
    ]) {
      expect(isIpAddress(wrapped), wrapped).toBe(false)
    }
  })

  it("accepts valid IPv4 and IPv6, including compression and v4-mapped", () => {
    for (const valid of [
      "1.2.3.4",
      "0.0.0.0",
      "255.255.255.255",
      "::1",
      "::",
      "2001:db8::1",
      "::ffff:1.2.3.4"
    ]) {
      expect(isIpAddress(valid), valid).toBe(true)
    }
  })

  it("rejects out-of-range octets, leading zeros, junk, and oversized strings", () => {
    for (const invalid of [
      "256.1.1.1",
      "01.2.3.4",
      "1.2.3",
      "1.2.3.4.5",
      "",
      "gggg::1",
      "::1::2",
      "x".repeat(60)
    ]) {
      expect(isIpAddress(invalid), invalid).toBe(false)
    }
  })
})

describe("getClientIp", () => {
  it("drops a port and IPv6 brackets from the trusted entry, returning the bare address", () => {
    // Azure's front door and IIS ARR write `address:port`; brackets are how an
    // IPv6 entry carries a port at all. What comes back is the bare address —
    // that is what becomes the rate-limit key and the stored column.
    const one = resolveClientIpOptions({ trustedProxies: 1 })
    expect(getClientIp(xff("203.0.113.7:54321"), one)).toBe("203.0.113.7")
    expect(getClientIp(xff("[2001:db8::1]:443"), one)).toBe("2001:db8::1")
    expect(getClientIp(xff("[2001:db8::1]"), one)).toBe("2001:db8::1")
    // Unbracketed IPv6 is left whole: its last group is a group, not a port.
    expect(getClientIp(xff("2001:db8::1:443"), one)).toBe("2001:db8::1:443")
    // The wrapper buys nothing for junk — what is inside is still validated.
    expect(getClientIp(xff("[not-an-ip]:443"), one)).toBeUndefined()
    expect(getClientIp(xff("203.0.113.7:port"), one)).toBeUndefined()
    // And it applies at the trusted position, not to whatever is leftmost.
    expect(getClientIp(xff("10.0.0.1, 203.0.113.7:54321"), one)).toBe(
      "203.0.113.7"
    )
  })

  it("derives nothing with the default zero trusted proxies", () => {
    // The header is client-controlled, so without a declared proxy no entry is
    // trustworthy — deriving one would let a caller rotate the header to dodge
    // the per-IP limit.
    const options = resolveClientIpOptions(undefined)
    expect(getClientIp(xff("203.0.113.7"), options)).toBeUndefined()
    expect(getClientIp(xff("203.0.113.7, 10.0.0.1"), options)).toBeUndefined()
  })

  it("takes the entry the trusted proxy wrote — the client cannot inject past it", () => {
    // One proxy appends the real client to the right of anything the client
    // sent, so a spoofed leftmost hop is ignored.
    const oneProxy = resolveClientIpOptions({ trustedProxies: 1 })
    expect(getClientIp(xff("9.9.9.9, 203.0.113.7"), oneProxy)).toBe(
      "203.0.113.7"
    )
    expect(getClientIp(xff("203.0.113.7"), oneProxy)).toBe("203.0.113.7")

    const twoProxies = resolveClientIpOptions({ trustedProxies: 2 })
    expect(getClientIp(xff("9.9.9.9, 203.0.113.7, 10.0.0.1"), twoProxies)).toBe(
      "203.0.113.7"
    )
  })

  it("treats true as one proxy", () => {
    expect(
      getClientIp(
        xff("9.9.9.9, 203.0.113.7"),
        resolveClientIpOptions({ trustedProxies: true })
      )
    ).toBe("203.0.113.7")
  })

  it("fails closed when the chain is shorter than the declared proxy count", () => {
    // Someone stripped a header, or the count is wrong. Do not fall back to the
    // leftmost, spoofable entry.
    expect(
      getClientIp(
        xff("203.0.113.7"),
        resolveClientIpOptions({ trustedProxies: 2 })
      )
    ).toBeUndefined()
  })

  it("rejects an oversized header before it can become a rate-limit key", () => {
    expect(
      getClientIp(
        xff("x".repeat(5000)),
        resolveClientIpOptions({ trustedProxies: 1 })
      )
    ).toBeUndefined()
  })

  it("rejects an entry that is not a valid IP", () => {
    expect(
      getClientIp(
        xff("not-an-ip"),
        resolveClientIpOptions({ trustedProxies: 1 })
      )
    ).toBeUndefined()
  })

  it("reads a configured single-value header, such as a CDN's", () => {
    const options = resolveClientIpOptions({
      header: "cf-connecting-ip",
      trustedProxies: 1
    })
    expect(
      getClientIp(new Headers({ "cf-connecting-ip": "203.0.113.7" }), options)
    ).toBe("203.0.113.7")
  })
})
