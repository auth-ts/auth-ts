import { AuthConfigError } from "../http/auth-config-error"
import type { LocalizationOptions } from "../http/get-error-message"
import { assertNoReservedFields } from "../http/validate-additional-fields"
import type { IpAddressConfig, IpAddressOptions } from "../lib/ip-address"
import { isTrustedProxyEntry, resolveIpAddressConfig } from "../lib/ip-address"
import type { Logger, LogLevel } from "../lib/logger"
import type { Duration } from "../lib/parse-duration"
import { parseDuration } from "../lib/parse-duration"
import { normalizeBasePath } from "../shared/base-path"
import type { AdditionalFieldsSchema, AuthDB, AuthTable } from "./auth-db"
import type {
  AuthOptions,
  EmailOptions,
  JwksOptions,
  JwtClaims,
  JwtOptions,
  ProviderCredentials,
  ProvidersOptions,
  RateLimitOptions,
  SessionOptions,
  SmsOptions
} from "./auth-options"

/**
 * The configuration the server runs on: {@link AuthOptions} after
 * defaults, environment lookups, and validation.
 *
 * Options are what you pass; this is what resolving them produces. The
 * difference is the point of having two types: every optional field here is
 * optional because it is genuinely absent from the deployment — no
 * `baseURL` — never because a default has not been applied yet. Exposed as
 * `auth.config`, and carried on the internals as `config`, so nothing
 * downstream of construction ever re-derives a default or re-checks a value.
 */
export interface AuthConfig {
  db: AuthDB
  generateId?: (table: AuthTable) => string | Promise<string>
  email?: EmailOptions
  sms?: SmsOptions
  guest: boolean
  providers: ProvidersOptions
  jwt: Required<Pick<JwtOptions, "privateKey" | "alg" | "ttl" | "claims">> &
    Pick<JwtOptions, "audience">
  jwks?: JwksOptions
  secret: string
  basePath: string
  baseURL?: string
  trustedProxyHeaders: boolean
  issuer?: string
  session: Required<SessionOptions>
  cookie: {
    name: string
    path: string
    /** Set only for a cross-subdomain deployment; see {@link CookieOptions.hintDomain}. */
    hintDomain?: string
    stateName: string
  }
  user: {
    additionalFields: AdditionalFieldsSchema
    deleteFreshWindow: Duration
  }
  rateLimit: Required<RateLimitOptions> | false
  multiUser: boolean
  localization?: LocalizationOptions
  ipAddress: IpAddressConfig
  trustedOrigins: string[]
  openapi: boolean
  logLevel: LogLevel
  logger?: Logger
  waitUntil?: (promise: Promise<unknown>) => void
}

/**
 * Field names core owns, which therefore cannot be declared as additional fields.
 *
 * `name` and `image` are included because `POST /user` takes a flat body: if
 * an additional field shared one of those names, the two would collide silently.
 * `locale` is deliberately *not* reserved — core stores no locale, so declaring
 * one as an additional field is exactly how you persist a preference.
 */
export const RESERVED_USER_FIELDS = [
  "id",
  "email",
  "phoneNumber",
  "type",
  "primaryUserId",
  "name",
  "image"
] as const

const DEFAULT_RATE_LIMIT: Required<RateLimitOptions> = {
  sendCodePerIdentifier: { max: 3, window: "10m" },
  sendCodePerIP: { max: 30, window: "10m" },
  signInCodePerIP: { max: 30, window: "10m" },
  deleteUserPerIdentifier: { max: 3, window: "10m" },
  guestPerIP: { max: 30, window: "10m" },
  sendCodeCooldown: "60s"
}

/** Reads an environment variable without assuming a Node-style global exists. */
function readEnvironmentVariable(name: string) {
  if (typeof process === "undefined") return undefined
  return process.env?.[name]
}

/**
 * Validates a duration option, returning it unchanged.
 *
 * `parseDuration` accepts a leading `-`, which is right for a general parser but
 * never right here: a negative TTL issues sessions and tokens that expired
 * before they were handed out, and a negative rate-limit window puts the window
 * start in the future. Both fail at runtime rather than at startup, which is
 * the trade this function exists to reverse.
 *
 * Zero is left alone deliberately. It is a documented value for
 * {@link UserOptions.deleteFreshWindow}, where it means no session is ever
 * fresh enough to skip the emailed code.
 */
function requireDuration(value: Duration, optionName: string) {
  let milliseconds: number
  try {
    milliseconds = parseDuration(value)
  } catch (error) {
    throw new AuthConfigError(`${optionName}: ${(error as Error).message}`)
  }

  if (milliseconds < 0) {
    throw new AuthConfigError(
      `${optionName}: must not be negative. ${JSON.stringify(value)} would place every expiry it governs in the past.`
    )
  }

  return value
}

/**
 * Validates a lifetime — a duration something must stay valid for.
 *
 * Stricter than {@link requireDuration}: zero is never a setting here, only a
 * mistake, and the bound is a whole second rather than zero because that is the
 * precision these lifetimes actually get. A token's `exp` and a cookie's
 * `Max-Age` are whole seconds, rounded down, so anything under one second
 * mints a token with `exp === iat` or a cookie the browser deletes on arrival —
 * and nothing fails until the first request with it.
 */
function requireLifetime(value: Duration, optionName: string) {
  requireDuration(value, optionName)

  if (parseDuration(value) < 1000) {
    throw new AuthConfigError(
      `${optionName}: must be at least one second. ${JSON.stringify(value)} rounds down to zero whole seconds, so everything it governs would expire the moment it was issued.`
    )
  }

  return value
}

/** Claims `signToken` owns outright; a configured default for one is a misconfiguration. */
const SERVER_OWNED_CLAIMS = ["sub", "iat", "exp"] as const

/**
 * Refuses claims that `signToken` owns.
 *
 * Configured claims sit under the caller's, but `sub`, `iat`, and `exp` are
 * not the caller's either — they are set by the signer from `userId`, the
 * clock, and `ttl`. A configured `sub` in particular would become the subject
 * of every token minted without a `userId`, which is a service token that
 * quietly claims to be a user.
 *
 * Exported because a `jwt.claims` function cannot be inspected at construction,
 * so the same rule has to be applied to whatever it returns.
 */
export function requireOwnedClaimsAbsent(claims: Record<string, unknown>) {
  for (const owned of SERVER_OWNED_CLAIMS) {
    if (owned in claims) {
      throw new AuthConfigError(
        `jwt.claims cannot set "${owned}": it is always derived by the signer (${SERVER_OWNED_CLAIMS.join(", ")} are server-owned).`
      )
    }
  }
  return claims
}

/** Applies the default claims, checking the object form while it can. */
function requireClaims(claims: JwtClaims | undefined): JwtClaims {
  if (claims === undefined) return { role: "authenticated" }

  return typeof claims === "function"
    ? claims
    : requireOwnedClaimsAbsent(claims)
}

/**
 * Resolves `ipAddress` and refuses a shape that could never derive an address.
 *
 * Each of these would pass silently and switch off every per-IP limit at
 * request time instead: a hop count that indexes no entry in the chain, a proxy
 * entry that is not an address or range and so matches nothing, a header list
 * with nothing in it, or a prefix length outside an IPv6 address. Refusing them
 * at construction is the difference between a typo you fix now and per-IP
 * limits that were never on.
 */
function requireIpAddress(options: IpAddressOptions | undefined) {
  const resolved = resolveIpAddressConfig(options)

  if (resolved.headers.length === 0 || resolved.headers.some((h) => h === "")) {
    throw new AuthConfigError(
      "ipAddress.headers must be a non-empty list of header names. An empty list leaves no header to read the client address from."
    )
  }

  if (Array.isArray(resolved.trustedProxies)) {
    const invalid = resolved.trustedProxies.filter(
      (entry) => !isTrustedProxyEntry(entry)
    )
    if (invalid.length > 0) {
      throw new AuthConfigError(
        `ipAddress.trustedProxies must be IP addresses or CIDR ranges, not ${invalid.map((entry) => JSON.stringify(entry)).join(", ")}. An entry that parses as neither matches no hop, so the whole chain would be treated as untrusted.`
      )
    }
  } else if (
    !Number.isSafeInteger(resolved.trustedProxies) ||
    resolved.trustedProxies < 0
  ) {
    throw new AuthConfigError(
      `ipAddress.trustedProxies must be a non-negative integer, a boolean, or a list of addresses, not ${String(options?.trustedProxies)}. A count that cannot address an entry in the forwarded chain would derive no client IP and silently disable every per-IP limit.`
    )
  }

  if (
    !Number.isSafeInteger(resolved.ipv6Subnet) ||
    resolved.ipv6Subnet < 0 ||
    resolved.ipv6Subnet > 128
  ) {
    throw new AuthConfigError(
      `ipAddress.ipv6Subnet must be a whole number of bits between 0 and 128, not ${String(options?.ipv6Subnet)}.`
    )
  }

  return resolved
}

/**
 * Refuses a provider whose credentials are missing or empty.
 *
 * The documented way to configure one is `process.env.GITHUB_CLIENT_ID as
 * string`, and an unset variable makes that `undefined` without a word from
 * the type checker. Left alone it becomes `client_id=undefined` in the
 * authorize URL — a round-trip to the provider and an error page there,
 * nowhere near the `.env` line that caused it.
 */
function requireProviders(providers: ProvidersOptions) {
  for (const [name, credentials] of Object.entries(providers) as Array<
    [string, ProviderCredentials | undefined]
  >) {
    if (!credentials) continue
    for (const field of ["clientId", "clientSecret"] as const) {
      const value = credentials[field]
      if (typeof value !== "string" || value.length === 0) {
        throw new AuthConfigError(
          `providers.${name}.${field} is missing or empty. Set it to the value from the provider's developer console; an unset environment variable is the usual cause.`
        )
      }
    }
  }
  return providers
}

/**
 * Merges rate-limit overrides over the defaults and validates the result.
 *
 * Two things a plain spread gets wrong. An explicit `undefined` — easy to
 * produce from `{ sendCodePerIP: process.env.X ? ... : undefined }` — would
 * overwrite the default with nothing, and the limiter would then read `.max`
 * off `undefined` on the first request. And the durations inside each window
 * would skip the validation every other duration option receives, so a typo
 * like `"10 minutes"` would be accepted here and explode at request time,
 * which is exactly what this function exists to prevent.
 */
function resolveRateLimit(
  overrides: RateLimitOptions | undefined
): Required<RateLimitOptions> {
  const defined = Object.fromEntries(
    Object.entries(overrides ?? {}).filter(([, value]) => value !== undefined)
  ) as RateLimitOptions
  const merged = { ...DEFAULT_RATE_LIMIT, ...defined }

  requireDuration(merged.sendCodeCooldown, "rateLimit.sendCodeCooldown")

  for (const [name, limit] of Object.entries(merged)) {
    if (typeof limit === "string") continue

    if (!Number.isInteger(limit.max) || limit.max < 1) {
      throw new AuthConfigError(
        `rateLimit.${name}.max must be a positive integer.`
      )
    }
    requireDuration(limit.window, `rateLimit.${name}.window`)
    // Zero is a real value for other durations, but not for a window. The store
    // starts a fresh window whenever `resetAt <= now()`, so a window that ends
    // the instant it starts resets the count to 1 on every request and the
    // limit never fires — silently. Below a millisecond rounds to the same
    // thing once it is added to a `Date`, so the bound is one millisecond, not
    // zero.
    if (parseDuration(limit.window) < 1) {
      throw new AuthConfigError(
        `rateLimit.${name}.window must be a positive duration. ${JSON.stringify(limit.window)} ends the moment it starts, so the count would reset on every request and the limit would never fire. To turn rate limiting off, set rateLimit: false.`
      )
    }
  }

  return merged
}

/** The shortest secret that is not a guess. `keygen` emits 43 base64url characters. */
const MINIMUM_SECRET_LENGTH = 32

/**
 * Applies defaults, reads secrets from the environment, and validates.
 *
 * Synchronous and free of input/output, so constructing a server is cheap enough
 * to memoize per tenant. Everything that can be wrong with a configuration is
 * rejected here rather than on the first request, with the offending option
 * named in the message.
 *
 * @throws {AuthConfigError} On any invalid or incomplete configuration.
 */
export function resolveAuthConfig(options: AuthOptions): AuthConfig {
  const basePath = normalizeBasePath(options.basePath ?? "/api/auth")
  const providers = requireProviders(options.providers ?? {})
  const guest = options.guest ?? false

  const hasSignInMethod =
    Boolean(options.email) ||
    Boolean(options.sms) ||
    guest ||
    Object.keys(providers).length > 0
  if (!hasSignInMethod) {
    throw new AuthConfigError(
      "No sign-in method configured. Provide at least one of: email, sms, guest: true, or providers."
    )
  }

  const privateKey =
    options.jwt?.privateKey ?? readEnvironmentVariable("JWT_PRIVATE_KEY")
  if (!privateKey) {
    throw new AuthConfigError(
      "Missing signing key. Set jwt.privateKey or the JWT_PRIVATE_KEY environment variable."
    )
  }

  const secret = options.secret ?? readEnvironmentVariable("AUTH_SECRET")
  if (!secret) {
    throw new AuthConfigError(
      "Missing server secret. Set secret or the AUTH_SECRET environment variable."
    )
  }
  if (secret === privateKey) {
    throw new AuthConfigError(
      "secret must not be the JWT signing key. They have different blast radiuses and are rotated independently."
    )
  }
  // Length, because entropy is not measurable from here — a 32-character
  // passphrase is weaker than 32 random bytes and both pass. What this catches
  // is the hand-written secret, which is the one that gets guessed: every OAuth
  // sign-in hands the browser an HMAC of a known message under this key, so a
  // short one is brute-forced offline rather than online.
  if (secret.length < MINIMUM_SECRET_LENGTH) {
    throw new AuthConfigError(
      `secret must be at least ${MINIMUM_SECRET_LENGTH} characters. It keys the verification-code HMAC, the provider-token encryption, and the OAuth state cookie — \`bun x @auth-ts/cli keygen\` generates one.`
    )
  }

  const baseURL = options.baseURL?.replace(/\/+$/, "")

  const additionalFields = options.user?.additionalFields ?? {}
  assertNoReservedFields(additionalFields, RESERVED_USER_FIELDS)

  const rateLimit =
    options.rateLimit === false ? false : resolveRateLimit(options.rateLimit)

  const cookieName = options.cookie?.name ?? "auth-ts.refresh"

  return {
    db: options.db,
    ...(options.generateId ? { generateId: options.generateId } : {}),
    ...(options.email ? { email: options.email } : {}),
    ...(options.sms ? { sms: options.sms } : {}),
    guest,
    providers,
    jwt: {
      privateKey,
      alg: options.jwt?.alg ?? "RS256",
      ttl: requireLifetime(options.jwt?.ttl ?? "10m", "jwt.ttl"),
      claims: requireClaims(options.jwt?.claims),
      ...(options.jwt?.audience ? { audience: options.jwt.audience } : {})
    },
    ...(options.jwks ? { jwks: requireJwks(options.jwks) } : {}),
    secret,
    basePath,
    ...(baseURL ? { baseURL, issuer: `${baseURL}${basePath}` } : {}),
    trustedProxyHeaders: options.trustedProxyHeaders ?? false,
    session: {
      ttl: requireLifetime(options.session?.ttl ?? "30d", "session.ttl"),
      sliding: options.session?.sliding ?? true
    },
    cookie: {
      name: cookieName,
      path: options.cookie?.path ?? "/",
      ...(options.cookie?.hintDomain
        ? { hintDomain: options.cookie.hintDomain }
        : {}),
      stateName: "auth-ts.state"
    },
    user: {
      additionalFields,
      deleteFreshWindow: requireDuration(
        options.user?.deleteFreshWindow ?? "15m",
        "user.deleteFreshWindow"
      )
    },
    rateLimit,
    multiUser: options.multiUser ?? false,
    ...(options.localization ? { localization: options.localization } : {}),
    ipAddress: requireIpAddress(options.ipAddress),
    trustedOrigins: options.trustedOrigins ?? [],
    openapi: options.openapi ?? false,
    logLevel: options.logLevel ?? "warn",
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.waitUntil ? { waitUntil: options.waitUntil } : {})
  }
}

/**
 * Checks that `jwks.json`, when given, is a key set and not the path to one.
 *
 * Served verbatim, so only the shape is checked: an object with a `keys` array.
 * The natural slip is passing the file's text, or its path, rather than the
 * parsed document, and a verifier would report that as "no key matched" a long
 * way from the mistake.
 */
function requireJwks(jwks: JwksOptions): JwksOptions {
  const { json } = jwks
  if (json === undefined) return jwks

  const isKeySet =
    typeof json === "object" &&
    json !== null &&
    Array.isArray((json as { keys?: unknown }).keys)
  if (!isKeySet) {
    throw new AuthConfigError(
      "jwks.json must be the parsed key set — an object with a keys array — not its text or path."
    )
  }

  return jwks
}
