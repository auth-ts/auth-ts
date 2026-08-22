/** How the client IP is derived from proxy headers. */
export interface ClientIpOptions {
  /**
   * The header carrying the forwarded address chain.
   *
   * `x-forwarded-for` for most reverse proxies; a single-value header a
   * platform guarantees it controls also works — `cf-connecting-ip` on
   * Cloudflare, `true-client-ip` on Akamai — since those cannot be spoofed
   * past the edge.
   *
   * An entry may carry a port — `203.0.113.7:54321`, `[2001:db8::1]:443` — as
   * Azure's front door and IIS ARR write it. The port is dropped, and the bare
   * address is what is validated, keyed, and stored.
   *
   * @default "x-forwarded-for"
   */
  header?: string
  /**
   * How many proxies you operate between the public internet and this app.
   *
   * This is the security boundary, and it defaults to **0** on purpose. The
   * header is written by whoever is talking to your outermost proxy, and a
   * client sets it freely. Proxies *append*, so the real client address is the
   * entry `trustedProxies` from the right — one trusted proxy means the
   * rightmost entry, two means the second from the right, and so on. Anything
   * to the left of that is attacker-controlled and ignored.
   *
   * With the default 0, no address is derived at all: there is no proxy we can
   * vouch for, so trusting any entry would let a caller rotate the header to
   * dodge the per-IP limit and store arbitrary values as the `ipAddress`
   * column. IP-keyed rate limits simply do not apply until you set this to your
   * real hop count — the per-identifier limits and the cooldown, which are what
   * actually protect a target inbox, are unaffected. `createAuthServer` logs a
   * warning at construction while this is the case and rate limiting is on,
   * so the gap is in your logs rather than discovered under attack.
   *
   * `true` is shorthand for 1. Anything other than a whole number of hops is
   * refused at construction, since it could never address an entry.
   *
   * @default 0
   */
  trustedProxies?: number | boolean
}

/** {@link ClientIpOptions} after defaults. */
export interface ClientIpConfig {
  header: string
  trustedProxies: number
}

/** The longest a forwarded header may be before it is refused unread. */
const MAX_FORWARDED_HEADER_LENGTH = 1024

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

/**
 * Strips the wrapper a proxy may put around an entry — `[2001:db8::1]:443`,
 * `[2001:db8::1]`, `203.0.113.7:54321` — leaving the bare address.
 *
 * Azure's front door and IIS ARR write `address:port` into `X-Forwarded-For`,
 * and brackets are the only unambiguous way to carry IPv6 there at all. The
 * entry being unwrapped is the one at the trusted position — written by your
 * proxy, not the client — and what comes out is still validated before it
 * becomes a rate-limit key or a stored column, so tolerating the wrapper gives
 * nothing away. Without it the address is rejected and IP-keyed limiting
 * silently stops applying on those platforms, which is the worse failure. An
 * unbracketed IPv6 is left whole: its last group is a group, not a port.
 */
function stripPort(entry: string): string {
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(entry)
  if (bracketed?.[1]) return bracketed[1]

  const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(entry)
  return withPort?.[1] ?? entry
}

/**
 * Derives the client IP from proxy headers, or `undefined` when none can be trusted.
 *
 * The address is taken from a fixed position in the forwarded chain — counted
 * from the right, past the proxies you declared you operate — and then validated
 * as a real IP. Both steps matter: the position stops a client from injecting a
 * spoofed hop that lands ahead of the real one, and the validation stops an
 * oversized or arbitrary string from becoming a rate-limit key or a stored
 * column. See {@link ClientIpOptions.trustedProxies} for why the default is to
 * derive nothing.
 *
 * One extractor, used everywhere an IP is read, so this is the single place the
 * behaviour is defined.
 */
export function getClientIp(
  headers: Headers,
  options: ClientIpConfig
): string | undefined {
  if (options.trustedProxies < 1) return undefined

  const raw = headers.get(options.header)
  if (!raw || raw.length > MAX_FORWARDED_HEADER_LENGTH) return undefined

  const chain = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

  // Proxies append, so the client is `trustedProxies` from the right. A chain
  // shorter than that was not written by the topology you declared — someone
  // stripped a header or the count is wrong — so fail closed rather than trust
  // whatever is leftmost.
  const candidate = chain[chain.length - options.trustedProxies]
  if (!candidate) return undefined

  const address = stripPort(candidate)
  return isIpAddress(address) ? address : undefined
}

/** Resolves {@link ClientIpOptions}, turning the `true` shorthand into 1. */
export function resolveClientIpConfig(
  options: ClientIpOptions | undefined
): ClientIpConfig {
  const trustedProxies = options?.trustedProxies
  return {
    header: options?.header ?? "x-forwarded-for",
    trustedProxies:
      trustedProxies === true
        ? 1
        : trustedProxies === false || trustedProxies === undefined
          ? 0
          : trustedProxies
  }
}
