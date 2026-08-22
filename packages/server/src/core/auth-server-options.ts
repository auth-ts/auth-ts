import { AuthConfigError } from "../http/auth-config-error.ts"
import type { LocalizationOptions } from "../http/get-error-message.ts"
import { assertNoReservedFields } from "../http/validate-additional-fields.ts"
import type { JwtAlgorithm } from "../jwt/import-signing-key.ts"
import type {
  ClientIpOptions,
  ResolvedClientIpOptions
} from "../lib/get-client-ip.ts"
import { resolveClientIpOptions } from "../lib/get-client-ip.ts"
import type { Logger, LogLevel } from "../lib/logger.ts"
import type { Duration } from "../lib/parse-duration.ts"
import { parseDuration } from "../lib/parse-duration.ts"
import type { AuthDb } from "./auth-db.ts"

/** Everything a send callback is told about the code it is delivering. */
export interface SendCodeContext {
  /** The six-digit code, in plain text. Deliver it; never store it. */
  code: string
  /**
   * The locale core already resolved for this request. Use it as-is rather than
   * re-deriving one, so the email matches the error messages the user is seeing.
   */
  locale: string
  /**
   * The request's headers — not the `Request`, whose body has already been read
   * and would throw on a second read.
   *
   * Everything a sender legitimately needs is here: `Host` for multi-tenant
   * branding, `User-Agent` for a "new device" note.
   */
  headers: Headers
  /** Why the code was sent, so deletion mail can differ from sign-in mail. */
  purpose: "signIn" | "deleteUser"
}

/** Email delivery. Supplying this enables email as a sign-in method. */
export interface EmailOptions {
  sendCode(context: SendCodeContext & { email: string }): Promise<void> | void
}

/** SMS delivery. Supplying this enables phone as a sign-in method. */
export interface SmsOptions {
  sendCode(
    context: SendCodeContext & { phoneNumber: string }
  ): Promise<void> | void
}

/** Client credentials for one OAuth provider. */
export interface ProviderCredentials {
  clientId: string
  clientSecret: string
}

/** The OAuth providers shipped in v1. Adding more is configuration, not new endpoints. */
export interface ProvidersOptions {
  github?: ProviderCredentials
  google?: ProviderCredentials
}

/** Token signing and publication. */
export interface JwtOptions {
  /**
   * PKCS#8 private key PEM. Defaults to the `JWT_PRIVATE_KEY` environment
   * variable; construction throws if neither is set.
   */
  privateKey?: string
  /** @default "RS256" */
  alg?: JwtAlgorithm
  /** Access-token lifetime, which is also the revocation latency. @default "10m" */
  ttl?: Duration
  /**
   * Merged into every token, under the caller's own claims.
   *
   * `sub`, `iat`, and `exp` are refused here: the subject is always the
   * `userId` a token is minted for, and the timestamps always come from the
   * clock and `ttl`. A default for any of them would be either ignored or a
   * way to mint tokens for someone else, and neither is worth allowing.
   *
   * @default { role: "authenticated" }
   */
  claims?: Record<string, unknown>
  /**
   * Sets `aud` and makes verification enforce it.
   *
   * Unset by default: Neon and Supabase both accept tokens without an audience,
   * and a default value only creates a mismatch to debug.
   */
  audience?: string
  /**
   * SPKI PEM public keys to publish — and verify against — alongside the
   * current one during rotation.
   *
   * Every key's `kid` is its JWK thumbprint, so a key keeps the same `kid`
   * whether it is signing or listed here, and moving it between the two roles
   * is invisible to verifiers. Local `verifyToken` consults this list too.
   */
  additionalPublicKeys?: string[]
}

/** Refresh-token lifetime. */
export interface SessionOptions {
  /** @default "30d" */
  ttl?: Duration
  /** Extend expiry on each refresh. @default true */
  sliding?: boolean
}

/**
 * Refresh-cookie naming and scope.
 *
 * Security attributes are absent on purpose: `HttpOnly`, `Secure`, and
 * `SameSite=Lax` are always on, and no `Domain` is ever set. Making those
 * configurable would turn one careless line into an XSS or CSRF exposure.
 */
export interface CookieOptions {
  /** @default "auth-ts.refresh" */
  name?: string
  /**
   * Defaults to `basePath`, so the token is sent only to the auth mount.
   *
   * Set `"/"` when server-side rendering needs the session on page requests —
   * with the tradeoff that the refresh token then rides the `Cookie` header of
   * every same-origin request, and therefore into access logs and APM traces.
   */
  path?: string
}

/** The primitive types an additional field may hold. */
export type AdditionalFieldType = "string" | "number" | "boolean"

/** Declared additional fields, as a name → type map. */
export type AdditionalFieldsSchema = Record<string, AdditionalFieldType>

/** User-record behaviour. */
export interface UserOptions {
  /**
   * Extra fields your table has that sign-up may set and `PATCH /user` may edit.
   *
   * An allowlist, not a schema: undeclared keys in a request are rejected, and
   * declared fields are applied **on insert only** so that signing in cannot
   * overwrite an existing profile.
   */
  additionalFields?: AdditionalFieldsSchema
  /**
   * How recently the session must have authenticated for `DELETE /user` to act
   * immediately; older sessions are challenged with an emailed code.
   *
   * Measured from the session's `createdAt` — when identity was actually proven —
   * not from a sliding last-seen value, which says nothing about who is at the
   * keyboard now. `"0s"` always requires the code.
   *
   * @default "15m"
   */
  deleteFreshWindow?: Duration
}

/** One fixed-window rate limit. */
export interface RateLimitWindow {
  max: number
  window: Duration
}

/**
 * Built-in abuse limits, on by default.
 *
 * Scope is authentication abuse only — email spam and credential brute force.
 * This is not a general API limiter; broad limits belong in infrastructure in
 * front of everything, these routes included.
 */
export interface RateLimitOptions {
  /** Closes the resend-to-reset-attempts loop. @default { max: 3, window: "10m" } */
  sendCodePerIdentifier?: RateLimitWindow
  /** @default { max: 30, window: "10m" } */
  sendCodePerIP?: RateLimitWindow
  /**
   * Protects the population rather than one code: blocks cross-identifier
   * spraying and code-burning griefing, and bounds the non-atomic attempt count.
   * @default { max: 30, window: "10m" }
   */
  verifyCodePerIP?: RateLimitWindow
  /** @default { max: 3, window: "10m" } */
  deleteUserPerIdentifier?: RateLimitWindow
  /** @default { max: 30, window: "10m" } */
  guestPerIP?: RateLimitWindow
  /**
   * Minimum spacing between sends to one identifier.
   *
   * Windows cap volume; this caps rapid-fire. Derived from the live code's
   * `expiresAt` minus the code TTL, so it adds no state and no callback.
   * @default "60s"
   */
  sendCodeCooldown?: Duration
}

/** Cross-origin access, for a client configured with a different `baseURL`. */
export interface CorsOptions {
  /** The exact allowed origin. Never `*`, because these responses carry credentials. */
  origin: string
}

/** Options accepted by `createAuthServer`. */
export interface AuthServerOptions {
  /** The callbacks that read and write your database. */
  db: AuthDb
  /** Sign-in method: magic codes over email. */
  email?: EmailOptions
  /** Sign-in method: magic codes over SMS. */
  sms?: SmsOptions
  /**
   * Enables `POST /sign-in/guest`.
   *
   * Off by default because anonymous account creation is an attack surface you
   * should opt into; it is per-IP rate limited even when on.
   * @default false
   */
  guest?: boolean
  /** Sign-in method: OAuth. Requires {@link AuthServerOptions.baseURL}. */
  providers?: ProvidersOptions
  /** Token signing, lifetime, claims, and key publication. */
  jwt?: JwtOptions
  /**
   * Server secret that keys the magic-code HMAC and signs the OAuth state
   * cookie. Defaults to the `AUTH_SECRET` environment variable.
   *
   * Must not be the JWT key: different type, different blast radius, rotated
   * independently.
   */
  secret?: string
  /** Where the handlers are mounted. Drives cookie path and OAuth callback URLs. @default "/api/auth" */
  basePath?: string
  /**
   * Absolute origin of this server. **Required when `providers` is set**, because
   * an OAuth `redirect_uri` must never be derived from a request header an
   * attacker can set.
   */
  baseURL?: string
  /** Refresh-token lifetime and whether it slides on use. */
  session?: SessionOptions
  /** Refresh-cookie name and scope. Security attributes are fixed, not options. */
  cookie?: CookieOptions
  /** Additional user fields and the account-deletion freshness window. */
  user?: UserOptions
  /**
   * Set `false` to disable the built-in limiter and bring your own.
   *
   * That turns off the per-IP and per-identifier windows and the send cooldown.
   * The five-guess cap on each magic code is not a rate and stays on: it is
   * counted through `upsertRateLimit` regardless, since nothing in front of this
   * server can enforce a per-code limit.
   */
  rateLimit?: RateLimitOptions | false
  /**
   * Google-style account switching: several users signed in to one browser.
   *
   * Named for what it multiplies — accounts per browser. Sessions per user are
   * already plural; that is the devices list.
   * @default false
   */
  multiAccount?: boolean
  /**
   * Sweep expired rows after every mutating flow, fire and forget.
   *
   * Hygiene, never a security boundary: expiry is enforced on read regardless.
   * @default true
   */
  cleanup?: boolean
  /** Server-side localization of error messages. Codes stay stable; only messages translate. */
  localization?: LocalizationOptions
  /**
   * How the client IP is derived from proxy headers — the rate-limit key and
   * the stored `ipAddress`. Defaults to deriving nothing until you declare how
   * many proxies you run; see {@link ClientIpOptions.trustedProxies}.
   */
  clientIp?: ClientIpOptions
  /** Cross-origin access, needed when the client is configured with a different `baseURL`. */
  cors?: CorsOptions
  /** @default "warn" */
  logLevel?: LogLevel
  /** Log sink override, e.g. pino. Defaults to `console`. */
  logger?: Logger
}

/** Options after defaults, environment lookups, and validation. */
export interface ResolvedAuthServerOptions {
  db: AuthDb
  email?: EmailOptions
  sms?: SmsOptions
  guest: boolean
  providers: ProvidersOptions
  jwt: Required<Pick<JwtOptions, "privateKey" | "alg" | "ttl" | "claims">> &
    Pick<JwtOptions, "audience" | "additionalPublicKeys">
  secret: string
  basePath: string
  baseURL?: string
  issuer?: string
  session: Required<SessionOptions>
  cookie: {
    name: string
    path: string
    accountsName: string
    stateName: string
  }
  user: {
    additionalFields: AdditionalFieldsSchema
    deleteFreshWindow: Duration
  }
  rateLimit: Required<RateLimitOptions> | false
  multiAccount: boolean
  cleanup: boolean
  localization?: LocalizationOptions
  clientIp: ResolvedClientIpOptions
  cors?: CorsOptions
  logLevel: LogLevel
  logger?: Logger
}

/**
 * Field names core owns, which therefore cannot be declared as additional fields.
 *
 * `name` and `imageURL` are included because `PATCH /user` takes a flat body: if
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
  "imageURL"
] as const

const DEFAULT_RATE_LIMIT: Required<RateLimitOptions> = {
  sendCodePerIdentifier: { max: 3, window: "10m" },
  sendCodePerIP: { max: 30, window: "10m" },
  verifyCodePerIP: { max: 30, window: "10m" },
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

/** Claims `signToken` owns outright; a configured default for one is a misconfiguration. */
const SERVER_OWNED_CLAIMS = ["sub", "iat", "exp"] as const

/**
 * Applies the default claims and refuses any that `signToken` owns.
 *
 * Configured claims sit under the caller's, but `sub`, `iat`, and `exp` are
 * not the caller's either — they are set by the signer from `userId`, the
 * clock, and `ttl`. A configured `sub` in particular would become the subject
 * of every token minted without a `userId`, which is a service token that
 * quietly claims to be a user.
 */
function requireClaims(claims: Record<string, unknown> | undefined) {
  const resolved = claims ?? { role: "authenticated" }
  for (const owned of SERVER_OWNED_CLAIMS) {
    if (owned in resolved) {
      throw new AuthConfigError(
        `jwt.claims cannot set "${owned}": it is always derived by the signer (${SERVER_OWNED_CLAIMS.join(", ")} are server-owned).`
      )
    }
  }
  return resolved
}

/**
 * Resolves `clientIp` and refuses a proxy count that cannot index the chain.
 *
 * `getClientIp` reads the entry `trustedProxies` from the right, so a fractional,
 * negative, or non-finite count matches no entry at all. That would not error —
 * it would derive no address and silently switch off every per-IP limit, which
 * is exactly the failure mode that is easiest to miss in production.
 */
function requireClientIp(options: ClientIpOptions | undefined) {
  const resolved = resolveClientIpOptions(options)
  if (
    !Number.isSafeInteger(resolved.trustedProxies) ||
    resolved.trustedProxies < 0
  ) {
    throw new AuthConfigError(
      `clientIp.trustedProxies must be a non-negative integer or a boolean, not ${String(options?.trustedProxies)}. A count that cannot address an entry in the forwarded chain would derive no client IP and silently disable every per-IP limit.`
    )
  }
  return resolved
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
export function resolveAuthServerOptions(
  options: AuthServerOptions
): ResolvedAuthServerOptions {
  const basePath = normalizeBasePath(options.basePath ?? "/api/auth")
  const providers = options.providers ?? {}
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

  const baseURL = options.baseURL?.replace(/\/+$/, "")
  if (Object.keys(providers).length > 0 && !baseURL) {
    throw new AuthConfigError(
      "baseURL is required when providers are configured: an OAuth redirect_uri must never come from a request header."
    )
  }

  const additionalFields = options.user?.additionalFields ?? {}
  assertNoReservedFields(additionalFields, RESERVED_USER_FIELDS)

  const rateLimit =
    options.rateLimit === false ? false : resolveRateLimit(options.rateLimit)

  // Resolved once: `accountsName` is derived from it, and the two must agree.
  const cookieName = options.cookie?.name ?? "auth-ts.refresh"

  return {
    db: options.db,
    ...(options.email ? { email: options.email } : {}),
    ...(options.sms ? { sms: options.sms } : {}),
    guest,
    providers,
    jwt: {
      privateKey,
      alg: options.jwt?.alg ?? "RS256",
      ttl: requireDuration(options.jwt?.ttl ?? "10m", "jwt.ttl"),
      claims: requireClaims(options.jwt?.claims),
      ...(options.jwt?.audience ? { audience: options.jwt.audience } : {}),
      ...(options.jwt?.additionalPublicKeys
        ? { additionalPublicKeys: options.jwt.additionalPublicKeys }
        : {})
    },
    secret,
    basePath,
    ...(baseURL ? { baseURL, issuer: `${baseURL}${basePath}` } : {}),
    session: {
      ttl: requireDuration(options.session?.ttl ?? "30d", "session.ttl"),
      sliding: options.session?.sliding ?? true
    },
    cookie: {
      name: cookieName,
      path: options.cookie?.path ?? basePath,
      accountsName: `${cookieName}.accounts`,
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
    multiAccount: options.multiAccount ?? false,
    cleanup: options.cleanup ?? true,
    ...(options.localization ? { localization: options.localization } : {}),
    clientIp: requireClientIp(options.clientIp),
    ...(options.cors ? { cors: options.cors } : {}),
    logLevel: options.logLevel ?? "warn",
    ...(options.logger ? { logger: options.logger } : {})
  }
}

/** Normalizes the mount path to a leading slash and no trailing slash. */
function normalizeBasePath(basePath: string) {
  const withLeadingSlash = basePath.startsWith("/") ? basePath : `/${basePath}`
  return withLeadingSlash.length > 1
    ? withLeadingSlash.replace(/\/+$/, "")
    : withLeadingSlash
}
