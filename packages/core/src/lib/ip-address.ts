/** How the client's IP address is derived from proxy headers. */
export interface IpAddressOptions {
  /**
   * Headers the address is read from, in order — the first that yields a
   * trustworthy address wins.
   *
   * `x-forwarded-for` covers most reverse proxies and is the default. A
   * single-value header the platform guarantees it controls is stronger —
   * `cf-connecting-ip` on Cloudflare, `true-client-ip` on Akamai — because a
   * client cannot append to it past the edge, so prefer one when your platform
   * sets it.
   *
   * An entry may carry a port — `203.0.113.7:54321`, `[2001:db8::1]:443` — as
   * Azure's front door and IIS ARR write it. The port is dropped, and the bare
   * address is what is validated, keyed, and stored.
   *
   * @default ["x-forwarded-for"]
   */
  headers?: string[]
  /**
   * The proxies you run between the public internet and this app, as a hop
   * count or as their addresses.
   *
   * The forwarded header is written by whoever talks to your outermost proxy
   * and proxies *append*, so the leftmost entry is whatever the client typed.
   * Declaring your topology is what makes the rest of the chain meaningful:
   *
   * - **A count** (`1`, or `true` for 1) reads the entry that many hops from
   *   the right. Use this on Cloudflare, Vercel, and other platforms whose
   *   proxy addresses you cannot enumerate.
   * - **A list** of addresses or CIDR ranges (`["10.0.0.0/24"]`) walks the
   *   chain right to left, skips hops you listed, and takes the first entry
   *   that is not one of yours. Use this when you run the proxies yourself.
   *
   * Left unset, only a header carrying a *single* entry is trusted — a chain is
   * ambiguous without knowing your topology, so none of it is used. That is the
   * zero-config case, and it is correct on any platform whose proxy overwrites
   * the header rather than appending to it.
   *
   * Neither form can verify who actually connected, only interpret what the
   * header says. Keep the app reachable only through those proxies.
   *
   * @default 0
   */
  trustedProxies?: string[] | number | boolean
  /**
   * The prefix length IPv6 addresses are grouped by when keying rate limits.
   *
   * A residential IPv6 client is handed a whole prefix — a `/64` by
   * [RFC 6177](https://datatracker.ietf.org/doc/html/rfc6177), often more — so
   * counting per address lets one client rotate through 2^64 of them without
   * ever filling a bucket. Limits key on the prefix instead; the address stored
   * on the session is untouched. IPv4 is always counted per address.
   *
   * @default 64
   */
  ipv6Subnet?: number
  /**
   * Derive no address at all.
   *
   * Nothing is read from any header, `session.ipAddress` stays null, and every
   * per-IP limit is inert — the per-identifier limits and the cooldown, which
   * are what protect a target inbox, are unaffected.
   *
   * @default false
   */
  disableTracking?: boolean
}

/** {@link IpAddressOptions} after defaults. */
export interface IpAddressConfig {
  headers: string[]
  /** A hop count, or the proxy addresses and CIDR ranges you operate. */
  trustedProxies: string[] | number
  ipv6Subnet: number
  disableTracking: boolean
}

/** The longest a forwarded header may be before it is refused unread. */
const MAX_FORWARDED_HEADER_LENGTH = 1024

/** What a request from your own machine reports as, during development. */
const LOOPBACK = "127.0.0.1"

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/** True for a well-formed dotted-quad with each octet 0–255 and no leading zeros. */
function isIPv4(value: string): boolean {
  const matched = IPV4.exec(value)
  if (!matched) return false

  return matched.slice(1).every((octet) => {
    if (octet.length > 1 && octet.startsWith("0")) return false
    return Number(octet) <= 255
  })
}

/**
 * True for a well-formed IPv6 address, including `::` compression and an
 * optional IPv4-mapped tail (`::ffff:1.2.3.4`).
 *
 * Web-standard `Request` gives no socket address, so `node:net`'s `isIP` is off
 * the table on edge runtimes — this is the check, kept deliberately strict.
 */
function isIPv6(value: string): boolean {
  const halves = value.split("::")
  if (halves.length > 2) return false

  const isGroup = (group: string) => /^[0-9a-fA-F]{1,4}$/.test(group)

  const parseSide = (side: string): number | null => {
    if (side === "") return 0
    const groups = side.split(":")

    // An IPv4-mapped tail counts as two 16-bit groups.
    const tail = groups[groups.length - 1]
    if (tail?.includes(".")) {
      if (!isIPv4(tail)) return null
      const head = groups.slice(0, -1)
      if (!head.every(isGroup)) return null
      return head.length + 2
    }

    if (!groups.every(isGroup)) return null
    return groups.length
  }

  if (halves.length === 2) {
    const left = parseSide(halves[0] ?? "")
    const right = parseSide(halves[1] ?? "")
    if (left === null || right === null) return false
    // The compressed run must stand for at least one omitted group.
    return left + right < 8
  }

  return parseSide(value) === 8
}

/** True when the value is a syntactically valid IPv4 or IPv6 address. */
export function isIpAddress(value: string): boolean {
  return isIPv4(value) || isIPv6(value)
}

/** A valid IPv6 address as its eight 16-bit groups, or `null` if it is not one. */
function expandIPv6(value: string): number[] | null {
  if (!isIPv6(value)) return null

  const parseSide = (side: string): number[] => {
    if (side === "") return []

    return side.split(":").flatMap((group) => {
      if (!group.includes(".")) return [Number.parseInt(group, 16)]
      // An IPv4-mapped tail is two groups: `1.2.3.4` is `0102:0304`.
      const octets = group.split(".").map(Number)
      return [
        ((octets[0] ?? 0) << 8) | (octets[1] ?? 0),
        ((octets[2] ?? 0) << 8) | (octets[3] ?? 0)
      ]
    })
  }

  const halves = value.split("::")
  const left = parseSide(halves[0] ?? "")
  if (halves.length === 1) return left

  const right = parseSide(halves[1] ?? "")
  const omitted = Array<number>(8 - left.length - right.length).fill(0)
  return [...left, ...omitted, ...right]
}

/**
 * Eight groups back to text, compressed per
 * [RFC 5952](https://datatracker.ietf.org/doc/html/rfc5952): lowercase, no
 * leading zeros, and the longest run of zero groups written as `::`.
 */
function formatIPv6(groups: number[]): string {
  let runStart = -1
  let runLength = 0
  let start = -1

  for (let index = 0; index <= groups.length; index++) {
    if (groups[index] === 0) {
      if (start === -1) start = index
      continue
    }
    if (start !== -1 && index - start > runLength) {
      runStart = start
      runLength = index - start
    }
    start = -1
  }

  const parts = groups.map((group) => group.toString(16))
  // A single zero group is written out; `::` must stand for two or more.
  if (runLength < 2) return parts.join(":")

  return `${parts.slice(0, runStart).join(":")}::${parts.slice(runStart + runLength).join(":")}`
}

/**
 * The one spelling of an address, so two ways of writing the same one cannot
 * become two rate-limit keys or two different-looking session rows.
 *
 * `2001:DB8::0001` and `2001:db8:0:0:0:0:0:1` are the same address, and
 * `::ffff:203.0.113.7` is an IPv4 address wearing an IPv6 hat — an attacker who
 * can pick the spelling gets a fresh bucket for each one otherwise. IPv6 comes
 * back compressed rather than expanded: it is the same value either way, and
 * this is the form that ends up in front of a user in a session list.
 */
export function normalizeIpAddress(address: string): string {
  if (isIPv4(address)) return address

  const groups = expandIPv6(address)
  if (!groups) return address

  const mapped =
    groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff
  if (mapped) {
    const high = groups[6] ?? 0
    const low = groups[7] ?? 0
    return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`
  }

  return formatIPv6(groups)
}

/**
 * The address as a rate-limit key: IPv4 as itself, IPv6 masked to
 * {@link IpAddressOptions.ipv6Subnet} so a client cannot walk its own prefix
 * into a fresh bucket per request.
 */
export function getIpAddressKey(
  address: string,
  config: IpAddressConfig
): string {
  const groups = expandIPv6(address)
  if (!groups || config.ipv6Subnet >= 128) return address

  const masked = groups.map((group, index) => {
    const bits = Math.min(16, Math.max(0, config.ipv6Subnet - index * 16))
    return bits === 0 ? 0 : group & ((0xffff << (16 - bits)) & 0xffff)
  })

  return `${formatIPv6(masked)}/${config.ipv6Subnet}`
}

/** An address as its raw bytes, for comparing against a CIDR range. */
function ipToBytes(address: string): Uint8Array | null {
  if (isIPv4(address)) {
    return Uint8Array.from(address.split(".").map(Number))
  }

  const groups = expandIPv6(address)
  if (!groups) return null

  const bytes = new Uint8Array(16)
  groups.forEach((group, index) => {
    bytes[index * 2] = group >> 8
    bytes[index * 2 + 1] = group & 0xff
  })
  return bytes
}

interface CidrRange {
  bytes: Uint8Array
  prefix: number
}

/**
 * An address or `address/prefix` as a range, or `null` when it is neither.
 *
 * Parsing is what validates a `trustedProxies` entry: a malformed one that
 * simply never matched would quietly turn the whole list into "trust nothing".
 */
function parseCidr(value: string): CidrRange | null {
  const slash = value.lastIndexOf("/")
  const bytes = ipToBytes(
    slash === -1 ? value : normalizeIpAddress(value.slice(0, slash))
  )
  if (!bytes) return null

  const maxBits = bytes.length * 8
  if (slash === -1) return { bytes, prefix: maxBits }

  const prefix = value.slice(slash + 1)
  if (!/^\d{1,3}$/.test(prefix)) return null

  return Number(prefix) <= maxBits ? { bytes, prefix: Number(prefix) } : null
}

/** Whether an address falls inside a range. */
function matchesCidr(address: Uint8Array, range: CidrRange): boolean {
  if (address.length !== range.bytes.length) return false

  let remaining = range.prefix
  for (let index = 0; index < address.length && remaining > 0; index++) {
    const bits = Math.min(8, remaining)
    const mask = (0xff << (8 - bits)) & 0xff
    if (((address[index] ?? 0) & mask) !== ((range.bytes[index] ?? 0) & mask)) {
      return false
    }
    remaining -= bits
  }
  return true
}

/** True when a `trustedProxies` entry is a usable address or CIDR range. */
export function isTrustedProxyEntry(value: string): boolean {
  return parseCidr(value) !== null
}

/**
 * Strips the wrapper a proxy may put around an entry — `[2001:db8::1]:443`,
 * `[2001:db8::1]`, `203.0.113.7:54321` — leaving the bare address.
 *
 * Azure's front door and IIS ARR write `address:port` into `X-Forwarded-For`,
 * and brackets are the only unambiguous way to carry IPv6 there at all. What
 * comes out is still validated before it becomes a rate-limit key or a stored
 * column, so tolerating the wrapper gives nothing away. Without it the address
 * is rejected and IP-keyed limiting silently stops applying on those platforms,
 * which is the worse failure. An unbracketed IPv6 is left whole: its last group
 * is a group, not a port.
 */
function stripPort(entry: string): string {
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(entry)
  if (bracketed?.[1]) return bracketed[1]

  const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(entry)
  return withPort?.[1] ?? entry
}

/** The client's address from one header's value, or `undefined` if none of it can be trusted. */
function fromForwardedChain(
  value: string,
  config: IpAddressConfig
): string | undefined {
  const chain = value
    .split(",")
    .map((entry) => stripPort(entry.trim()))
    .filter((entry) => entry.length > 0)
  if (chain.length === 0) return undefined

  const candidate = Array.isArray(config.trustedProxies)
    ? fromProxyList(chain, config.trustedProxies)
    : fromHopCount(chain, config.trustedProxies)

  return candidate && isIpAddress(candidate)
    ? normalizeIpAddress(candidate)
    : undefined
}

/**
 * The entry `hops` from the right, or — with no hops declared — the value of a
 * header that carries exactly one entry.
 *
 * A chain shorter than the declared hop count was not written by the topology
 * you described: someone stripped a header or the count is wrong, so nothing is
 * returned rather than falling back to an entry the client may have written.
 */
function fromHopCount(chain: string[], hops: number): string | undefined {
  if (hops >= 1) return chain[chain.length - hops]
  return chain.length === 1 ? chain[0] : undefined
}

/**
 * The rightmost entry that is not one of your proxies.
 *
 * An entry that is not an address at all ends the walk — the chain stopped
 * making sense, so no part of it is trusted. Every entry being yours means the
 * chain never reached a client, which is likewise nothing to return.
 */
function fromProxyList(
  chain: string[],
  trustedProxies: string[]
): string | undefined {
  const ranges = trustedProxies
    .map(parseCidr)
    .filter((range): range is CidrRange => range !== null)
  if (ranges.length === 0) return undefined

  for (let index = chain.length - 1; index >= 0; index--) {
    const entry = chain[index]
    const bytes = entry ? ipToBytes(normalizeIpAddress(entry)) : null
    if (!entry || !bytes) return undefined
    if (!ranges.some((range) => matchesCidr(bytes, range))) return entry
  }

  return undefined
}

/**
 * A local request has no forwarded header and no address to report, which would
 * leave `session.ipAddress` null and every per-IP limit untestable on the one
 * machine where you want to try them. During development that is worth more
 * than accuracy about an address everybody already knows, so it reports
 * loopback. `NODE_ENV` is read rather than configured because it is what a dev
 * server already sets; nothing is invented in production or under test.
 */
function developmentFallback(): string | undefined {
  const runtime = globalThis as {
    process?: { env?: Record<string, string | undefined> }
  }
  const nodeEnv = runtime.process?.env?.NODE_ENV
  return nodeEnv === "development" || nodeEnv === "dev" ? LOOPBACK : undefined
}

/**
 * Derives the client's IP address from the request headers, or `undefined` when
 * none can be trusted.
 *
 * Headers are read in the configured order, the entry is picked from the chain
 * by the topology you declared, and only then is it validated as a real address
 * and normalized. Every step matters: the position stops a client from
 * injecting a spoofed hop that lands ahead of the real one, the validation
 * stops an arbitrary string from becoming a rate-limit key or a stored column,
 * and the normalization stops two spellings of one address becoming two keys.
 *
 * One extractor, used everywhere an address is read, so this is the single
 * place the behaviour is defined. See {@link IpAddressOptions.trustedProxies}
 * for what is trusted before you configure anything.
 */
export function getIpAddress(
  headers: Headers,
  config: IpAddressConfig
): string | undefined {
  if (config.disableTracking) return undefined

  for (const header of config.headers) {
    const value = headers.get(header)
    if (!value || value.length > MAX_FORWARDED_HEADER_LENGTH) continue

    const address = fromForwardedChain(value, config)
    if (address) return address
  }

  return developmentFallback()
}

/** Resolves {@link IpAddressOptions}, turning the `true` shorthand into one hop. */
export function resolveIpAddressConfig(
  options: IpAddressOptions | undefined
): IpAddressConfig {
  const trustedProxies = options?.trustedProxies

  return {
    headers: options?.headers ?? ["x-forwarded-for"],
    trustedProxies:
      trustedProxies === true
        ? 1
        : trustedProxies === false || trustedProxies === undefined
          ? 0
          : trustedProxies,
    ipv6Subnet: options?.ipv6Subnet ?? 64,
    disableTracking: options?.disableTracking ?? false
  }
}
