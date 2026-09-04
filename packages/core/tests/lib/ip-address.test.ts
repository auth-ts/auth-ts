import { describe, expect, it } from "vitest"
import {
  getIpAddress,
  getIpAddressKey,
  isIpAddress,
  isTrustedProxyEntry,
  normalizeIpAddress,
  resolveIpAddressConfig
} from "../../src/lib/ip-address"

const xff = (value: string) => new Headers({ "x-forwarded-for": value })
const config = (options?: Parameters<typeof resolveIpAddressConfig>[0]) =>
  resolveIpAddressConfig(options)

describe("isIpAddress", () => {
  it("stays strict about wrappers — unwrapping is getIpAddress's job, on the trusted entry only", () => {
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

describe("normalizeIpAddress", () => {
  it("gives one spelling per address, so one address cannot become two keys", () => {
    for (const [written, canonical] of [
      ["2001:DB8:0000:0000:0000:0000:0000:0001", "2001:db8::1"],
      ["2001:db8:0:0:0:0:0:1", "2001:db8::1"],
      ["2001:db8::1", "2001:db8::1"],
      ["0:0:0:0:0:0:0:1", "::1"],
      ["::", "::"],
      // A zero group on its own is written out; `::` stands for two or more.
      ["1:0:2:3:4:5:6:7", "1:0:2:3:4:5:6:7"],
      // The longest run wins, and the leftmost of equal runs.
      ["1:0:0:2:0:0:0:3", "1:0:0:2::3"],
      ["1:0:0:2:0:0:3:4", "1::2:0:0:3:4"]
    ] as const) {
      expect(normalizeIpAddress(written), written).toBe(canonical)
    }
  })

  it("unmasks an IPv4-mapped address, which is an IPv4 client in disguise", () => {
    // Otherwise a client alternates between the two spellings for two buckets.
    expect(normalizeIpAddress("::ffff:203.0.113.7")).toBe("203.0.113.7")
    expect(normalizeIpAddress("::FFFF:203.0.113.7")).toBe("203.0.113.7")
    expect(normalizeIpAddress("0:0:0:0:0:ffff:cb00:7107")).toBe("203.0.113.7")
  })

  it("leaves IPv4 alone", () => {
    expect(normalizeIpAddress("203.0.113.7")).toBe("203.0.113.7")
  })
})

describe("getIpAddress", () => {
  it("derives an address with no configuration at all, when the header is unambiguous", () => {
    // The zero-config case: a platform that overwrites the header rather than
    // appending to it leaves exactly one entry, and that is the client.
    expect(getIpAddress(xff("203.0.113.7"), config())).toBe("203.0.113.7")
    expect(getIpAddress(xff(" 203.0.113.7 "), config())).toBe("203.0.113.7")
  })

  it("refuses an undeclared chain rather than trusting a spoofable entry", () => {
    // Two entries means either a real second hop or a client that wrote one.
    // Without a declared topology there is no way to tell, so neither is used.
    expect(getIpAddress(xff("9.9.9.9, 203.0.113.7"), config())).toBeUndefined()
  })

  it("takes the entry the trusted proxy wrote — the client cannot inject past it", () => {
    const oneProxy = config({ trustedProxies: 1 })
    expect(getIpAddress(xff("9.9.9.9, 203.0.113.7"), oneProxy)).toBe(
      "203.0.113.7"
    )
    expect(getIpAddress(xff("203.0.113.7"), oneProxy)).toBe("203.0.113.7")

    const twoProxies = config({ trustedProxies: 2 })
    expect(
      getIpAddress(xff("9.9.9.9, 203.0.113.7, 10.0.0.1"), twoProxies)
    ).toBe("203.0.113.7")
  })

  it("treats true as one proxy", () => {
    expect(
      getIpAddress(
        xff("9.9.9.9, 203.0.113.7"),
        config({ trustedProxies: true })
      )
    ).toBe("203.0.113.7")
  })

  it("fails closed when the chain is shorter than the declared proxy count", () => {
    // Someone stripped a header, or the count is wrong. Do not fall back to the
    // leftmost, spoofable entry.
    expect(
      getIpAddress(xff("203.0.113.7"), config({ trustedProxies: 2 }))
    ).toBeUndefined()
  })

  it("walks a proxy list right to left and stops at the first hop that is not yours", () => {
    const options = config({ trustedProxies: ["10.0.0.0/24", "192.0.2.10"] })

    expect(
      getIpAddress(xff("203.0.113.7, 10.0.0.9, 192.0.2.10"), options)
    ).toBe("203.0.113.7")
    expect(getIpAddress(xff("203.0.113.7"), options)).toBe("203.0.113.7")
    // A hop outside the ranges is the client, even with more to its left.
    expect(getIpAddress(xff("9.9.9.9, 203.0.113.7, 10.0.0.9"), options)).toBe(
      "203.0.113.7"
    )
    // Every hop being yours means the chain never reached a client.
    expect(getIpAddress(xff("10.0.0.9, 192.0.2.10"), options)).toBeUndefined()
    // A hop that is not an address at all ends the walk: nothing to trust.
    expect(getIpAddress(xff("203.0.113.7, junk, 10.0.0.9"), options)).toBe(
      undefined
    )
  })

  it("matches an IPv6 proxy range, and an IPv4-mapped hop as the IPv4 it is", () => {
    expect(
      getIpAddress(
        xff("203.0.113.7, 2001:db8::5"),
        config({ trustedProxies: ["2001:db8::/32"] })
      )
    ).toBe("203.0.113.7")

    expect(
      getIpAddress(
        xff("203.0.113.7, ::ffff:10.0.0.9"),
        config({ trustedProxies: ["10.0.0.0/24"] })
      )
    ).toBe("203.0.113.7")
  })

  it("reads the headers in order and takes the first that yields an address", () => {
    const options = config({ headers: ["cf-connecting-ip", "x-forwarded-for"] })
    const headers = new Headers({
      "cf-connecting-ip": "203.0.113.7",
      "x-forwarded-for": "9.9.9.9"
    })

    expect(getIpAddress(headers, options)).toBe("203.0.113.7")
    // Falls through when the first header is absent or unusable.
    expect(getIpAddress(xff("9.9.9.9"), options)).toBe("9.9.9.9")
    expect(
      getIpAddress(new Headers({ "cf-connecting-ip": "junk" }), options)
    ).toBeUndefined()
  })

  it("drops a port and IPv6 brackets from the trusted entry, returning the bare address", () => {
    // Azure's front door and IIS ARR write `address:port`; brackets are how an
    // IPv6 entry carries a port at all. What comes back is the bare address —
    // that is what becomes the rate-limit key and the stored column.
    const one = config({ trustedProxies: 1 })
    expect(getIpAddress(xff("203.0.113.7:54321"), one)).toBe("203.0.113.7")
    expect(getIpAddress(xff("[2001:db8::1]:443"), one)).toBe("2001:db8::1")
    expect(getIpAddress(xff("[2001:db8::1]"), one)).toBe("2001:db8::1")
    // Unbracketed IPv6 is left whole: its last group is a group, not a port.
    expect(getIpAddress(xff("2001:db8::1:443"), one)).toBe("2001:db8::1:443")
    // The wrapper buys nothing for junk — what is inside is still validated.
    expect(getIpAddress(xff("[not-an-ip]:443"), one)).toBeUndefined()
    expect(getIpAddress(xff("203.0.113.7:port"), one)).toBeUndefined()
    // And it applies at the trusted position, not to whatever is leftmost.
    expect(getIpAddress(xff("10.0.0.1, 203.0.113.7:54321"), one)).toBe(
      "203.0.113.7"
    )
  })

  it("returns the address in canonical form, whatever the proxy wrote", () => {
    expect(getIpAddress(xff("2001:DB8:0:0:0:0:0:1"), config())).toBe(
      "2001:db8::1"
    )
    expect(getIpAddress(xff("::ffff:203.0.113.7"), config())).toBe(
      "203.0.113.7"
    )
  })

  it("rejects an oversized header before it can become a rate-limit key", () => {
    expect(getIpAddress(xff("x".repeat(5000)), config())).toBeUndefined()
  })

  it("rejects an entry that is not a valid IP", () => {
    expect(getIpAddress(xff("not-an-ip"), config())).toBeUndefined()
    expect(getIpAddress(xff(""), config())).toBeUndefined()
  })

  it("derives nothing at all when tracking is off", () => {
    const off = config({ disableTracking: true, trustedProxies: 1 })
    expect(getIpAddress(xff("203.0.113.7"), off)).toBeUndefined()
  })
})

describe("getIpAddressKey", () => {
  it("keys IPv4 per address", () => {
    expect(getIpAddressKey("203.0.113.7", config())).toBe("203.0.113.7")
  })

  it("keys IPv6 by prefix, so one client cannot spend its allocation on buckets", () => {
    // A residential client is handed a /64 or wider; counting per address would
    // let it rotate through 2^64 of them without filling a bucket.
    const options = config()
    expect(getIpAddressKey("2001:db8:1:2:3:4:5:6", options)).toBe(
      "2001:db8:1:2::/64"
    )
    expect(getIpAddressKey("2001:db8:1:2:aaaa::1", options)).toBe(
      "2001:db8:1:2::/64"
    )
    expect(getIpAddressKey("2001:db8:1:3::1", options)).toBe(
      "2001:db8:1:3::/64"
    )
  })

  it("honours a wider or narrower prefix", () => {
    expect(
      getIpAddressKey("2001:db8:1:2:3:4:5:6", config({ ipv6Subnet: 56 }))
    ).toBe("2001:db8:1::/56")
    expect(
      getIpAddressKey("2001:db8:1:2:3:4:5:6", config({ ipv6Subnet: 48 }))
    ).toBe("2001:db8:1::/48")
    // 128 is the address itself, ungrouped.
    expect(
      getIpAddressKey("2001:db8:1:2:3:4:5:6", config({ ipv6Subnet: 128 }))
    ).toBe("2001:db8:1:2:3:4:5:6")
    // A prefix that falls mid-group masks the bits inside it.
    // 24 bits is the first group plus the top half of the second.
    expect(getIpAddressKey("2001:dbff::1", config({ ipv6Subnet: 24 }))).toBe(
      "2001:db00::/24"
    )
  })
})

describe("isTrustedProxyEntry", () => {
  it("accepts addresses and ranges, and refuses anything that would match nothing", () => {
    for (const valid of [
      "203.0.113.7",
      "10.0.0.0/24",
      "10.0.0.0/32",
      "::1",
      "2001:db8::/32",
      "::ffff:10.0.0.1"
    ]) {
      expect(isTrustedProxyEntry(valid), valid).toBe(true)
    }

    for (const invalid of [
      "",
      "not-an-ip",
      "10.0.0.0/",
      "10.0.0.0/33",
      "2001:db8::/129",
      "10.0.0.0/x"
    ]) {
      expect(isTrustedProxyEntry(invalid), invalid).toBe(false)
    }
  })
})
