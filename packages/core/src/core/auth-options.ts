import type { LocalizationOptions } from "../http/get-error-message"
import type { JwtAlgorithm } from "../jwt/import-signing-key"
import type { IpAddressOptions } from "../lib/ip-address"
import type { Logger, LogLevel } from "../lib/logger"
import type { Duration } from "../lib/parse-duration"
import type {
  AdditionalFieldsSchema,
  AuthDatabase,
  AuthSession,
  AuthTable,
  AuthUser
} from "./auth-database"

// Input types only, so the docs render them from source.

/** What `sendCode` is told about the code to deliver. */
export interface SendCodeContext {
  /** The code in plain text. Deliver it; never store it. */
  code: string
  /** The locale this request resolved to, matching its error messages. */
  locale: string
  /** The request's headers, e.g. `Host` for branding or `User-Agent`. */
  headers: Headers
  /** Why the code was sent, so each email can read differently. */
  purpose: "signIn" | "identity" | "emailChange" | "phoneChange"
}

/** What every changed-identifier notification is told. */
export interface ChangedNotificationContext {
  /** The user, carrying the new identifier. */
  user: AuthUser
  /** The locale this request resolved to. */
  locale: string
  /** The request's headers. */
  headers: Headers
}

/** What an email-changed notification is told. */
export interface EmailChangedNotificationContext
  extends ChangedNotificationContext {
  /** The address that was replaced. */
  email: string
}

/** What a phone-number-changed notification is told. */
export interface PhoneNumberChangedNotificationContext
  extends ChangedNotificationContext {
  /** The number that was replaced. */
  phoneNumber: string
}

/** What a signed-in notification is told. */
export interface SignedInNotificationContext {
  /** The account's address. */
  email: string
  /** The user who signed in. */
  user: AuthUser
  /** The new session: `userAgent`, `ipAddress`, `createdAt` and `amr`. */
  session: AuthSession
  /** The locale this request resolved to. */
  locale: string
  /** The request's headers. */
  headers: Headers
}

/** Email delivery. Setting it enables email sign-in. */
export interface EmailOptions {
  /** Sends a verification code by email. */
  sendCode(context: SendCodeContext & { email: string }): Promise<void> | void
  /** Tells an existing account that someone signed in. A failure is logged. */
  sendSignedInNotification?(
    context: SignedInNotificationContext
  ): Promise<void> | void
  /** Tells the old address it was replaced. A failure is logged. */
  sendEmailChangedNotification?(
    context: EmailChangedNotificationContext
  ): Promise<void> | void
}

/** SMS delivery. Setting it enables phone sign-in. */
export interface SmsOptions {
  /** Sends a verification code by text message. */
  sendCode(
    context: SendCodeContext & { phoneNumber: string }
  ): Promise<void> | void
  /** Tells the old number it was replaced. A failure is logged. */
  sendPhoneNumberChangedNotification?(
    context: PhoneNumberChangedNotificationContext
  ): Promise<void> | void
}

/** Client credentials for one OAuth provider. */
export interface ProviderCredentials {
  /** The OAuth app's client ID. */
  clientId: string
  /** The OAuth app's client secret. */
  clientSecret: string
  /** Scopes to request beyond the ones sign-in needs. */
  scopes?: string[]
  /**
   * Requests a refresh token for later API calls. Google then shows consent on every sign-in.
   * @default false
   */
  offlineAccess?: boolean
}

/** The OAuth providers. */
export interface ProvidersOptions {
  /** Sign in with GitHub. */
  github?: ProviderCredentials
  /** Sign in with Google. */
  google?: ProviderCredentials
}

/**
 * Claims merged into every session token: an object, or a function of the user and session.
 * `sub`, `iat` and `exp` are refused.
 */
export type JwtClaims =
  | Record<string, unknown>
  | ((
      user: AuthUser,
      session: AuthSession
    ) => Record<string, unknown> | Promise<Record<string, unknown>>)

/** Token signing. */
export interface JwtOptions {
  /**
   * PKCS#8 private key PEM. Construction throws without one.
   * @default process.env.JWT_PRIVATE_KEY
   */
  privateKey?: string
  /**
   * Signing algorithm. Match `keygen --alg`.
   * @default "ES256"
   */
  alg?: JwtAlgorithm
  /**
   * Access-token lifetime, which is also the revocation delay.
   * @default "1h"
   */
  ttl?: Duration
  /**
   * Claims merged into every token.
   * @default { role: "authenticated" }
   */
  claims?: JwtClaims
  /** Sets `aud` and makes verification require it. */
  audience?: string
}

/** Where the public key set lives, when not at `<origin>/jwks.json`. */
export interface JwksOptions {
  /**
   * The key set's public URL, advertised as `jwks_uri`.
   * @default "<baseURL>/jwks.json"
   */
  url?: string
  /** The parsed `jwks.json`, served at `<basePath>/jwks`. */
  json?: unknown
}

/** Refresh-token lifetime. */
export interface SessionOptions {
  /**
   * How long a session lives past its last use, or past creation without `sliding`.
   * @default "10d"
   */
  ttl?: Duration
  /**
   * Extends expiry on use, so `ttl` measures inactivity. Written at most hourly.
   * @default true
   */
  sliding?: boolean
}

/** Refresh-cookie name and scope. `HttpOnly`, `Secure` and `SameSite=Lax` are fixed. */
export interface CookieOptions {
  /**
   * Stored as `__Host-<name>.<userId>` where the browser allows the prefix.
   * @default "auth-ts.refresh"
   */
  name?: string
  /**
   * Cookie path. Narrowing it to `basePath` stops server-side session reads.
   * @default "/"
   */
  path?: string
  /** Domain for the readable hint cookie, e.g. `"example.com"`. Only for cross-subdomain setups. */
  hintDomain?: string
}

/** User-record options. */
export interface UserOptions<
  S extends AdditionalFieldsSchema = AdditionalFieldsSchema
> {
  /** Extra users columns sign-up may set and `updateUser` may edit, e.g. `{ plan: "string" }`. */
  additionalFields?: S
}

/** A token bucket: `capacity` tokens, one back every `refill`. */
export interface RateLimitBucket {
  /** Tokens the bucket holds. */
  capacity: number
  /** Time to refill one token. */
  refill: Duration
}

/** Built-in limits on sign-in abuse. Not a general API limiter. */
export interface RateLimitOptions {
  /**
   * Wrong codes per address or user, from anyone. Stays on under `rateLimit: false`.
   * @default { capacity: 5, refill: "1m" }
   */
  guesses?: RateLimitBucket
  /**
   * Codes sent to one address, from anyone.
   * @default { capacity: 5, refill: "30m" }
   */
  sends?: RateLimitBucket
  /**
   * "Confirm it's you" codes per user, separate from `sends`.
   * @default { capacity: 5, refill: "1m" }
   */
  identitySends?: RateLimitBucket
  /**
   * Guest sign-ins per client IP.
   * @default { capacity: 30, refill: "2m" }
   */
  guestsPerIP?: RateLimitBucket
}

/** The shape of the codes `sendCode` delivers. */
export interface VerificationCodeOptions {
  /**
   * `alphanumeric` is A–Z and 2–9 without I, O, 0 and 1. `numeric` suits phone autofill.
   * @default "alphanumeric"
   */
  alphabet?: "alphanumeric" | "numeric"
  /**
   * Symbols per code, 6 to 12.
   * @default 6
   */
  length?: number
}

/** Options accepted by `createAuth`. */
export interface AuthOptions<
  S extends AdditionalFieldsSchema = AdditionalFieldsSchema
> {
  /**
   * The four functions that read and write your tables.
   * @remarks `AuthDatabase`
   */
  database: AuthDatabase<NoInfer<S>>
  /** Mints row ids. Leave unset to let your column defaults fill them. */
  generateId?: (table: AuthTable) => string | Promise<string>
  /** Email code sign-in. */
  email?: EmailOptions
  /** SMS code sign-in. */
  sms?: SmsOptions
  /**
   * Anonymous guest sign-in, rate limited per IP.
   * @default false
   */
  guest?: boolean
  /** GitHub and Google sign-in. */
  providers?: ProvidersOptions
  /** Token signing, lifetime and claims. */
  jwt?: JwtOptions
  /** Where the public key set lives. */
  jwks?: JwksOptions
  /**
   * Where the handler is mounted. OAuth callback URLs derive from it.
   * @default "/api/auth"
   */
  basePath?: string
  /** This server's origin, e.g. `https://app.example.com`. Required for `iss` and discovery. */
  baseURL?: string
  /**
   * Reads the origin from `X-Forwarded-Host` and `X-Forwarded-Proto`. Only behind a proxy that sets both.
   * @default false
   */
  trustedProxyHeaders?: boolean
  /** Refresh-token lifetime. */
  session?: SessionOptions
  /** Refresh-cookie name and scope. */
  cookie?: CookieOptions
  /** Additional user fields. */
  user?: UserOptions<S>
  /** Built-in rate limits. `false` keeps only `guesses`. */
  rateLimit?: RateLimitOptions | false
  /** Code alphabet and length. */
  verificationCode?: VerificationCodeOptions
  /**
   * Several users signed in to one browser, with account switching.
   * @default false
   */
  multiUser?: boolean
  /** Translated error messages. Codes stay the same. */
  localization?: LocalizationOptions
  /** How the client IP is read from proxy headers. */
  ipAddress?: IpAddressOptions
  /** Exact origins, besides this one, allowed to make state-changing requests. Never `*`. */
  trustedOrigins?: string[]
  /** Your platform's request id header, e.g. `cf-ray`. Returned with unexpected errors. */
  requestIdHeader?: string
  /**
   * Serves `{basePath}/openapi.json` and a browsable `{basePath}/reference`.
   * @default false
   */
  openapi?: boolean
  /**
   * Minimum level logged.
   * @default "warn"
   */
  logLevel?: LogLevel
  /**
   * Log sink, e.g. pino.
   * @default console
   */
  logger?: Logger
  /** Runs cleanup after the response, e.g. Cloudflare's `ctx.waitUntil`. */
  waitUntil?: (promise: Promise<unknown>) => void
}
