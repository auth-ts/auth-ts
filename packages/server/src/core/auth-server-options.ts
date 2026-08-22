import type { LocalizationOptions } from "../http/get-error-message"
import type { JwtAlgorithm } from "../jwt/import-signing-key"
import type { IpAddressOptions } from "../lib/ip-address"
import type { Logger, LogLevel } from "../lib/logger"
import type { Duration } from "../lib/parse-duration"
import type { AuthDB } from "./auth-db"

// The shapes `createAuthServer` accepts — and nothing else. Options are the
// partial, human-written input; what they resolve to is `AuthServerConfig`, in
// `auth-server-config.ts`, and failing to resolve is an `AuthConfigError`. Keeping
// the input types in a file of their own is what lets the documentation site
// render them from source without the resolver's plumbing in the way.

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
   * SPKI PEM public keys that local `verifyToken` also accepts — for keeping a
   * previous key's tokens valid through a rotation, alongside listing both keys
   * in the published `jwks.json`.
   *
   * Every key's `kid` is its JWK thumbprint, so a key keeps the same `kid`
   * whether it is signing or listed here, and moving it between the two roles
   * is invisible to verifiers.
   */
  additionalPublicKeys?: string[]
}

/**
 * Where the public key set lives.
 *
 * The JWKS is a static document: `npx @auth-ts/cli keygen` writes it to
 * `public/jwks.json`, and a framework with a public folder serves it at
 * `<origin>/jwks.json` with nothing to configure here. Both fields are for
 * when that is not the case.
 */
export interface JwksOptions {
  /**
   * The public URL of the key set, advertised as `jwks_uri` in the discovery
   * document. Defaults to `<baseURL>/jwks.json` — where a `public/jwks.json`
   * is served — or to the `/jwks` endpoint when {@link JwksOptions.json} is set.
   */
  url?: string
  /**
   * The key set itself, to serve from `<basePath>/jwks` for a runtime with no
   * public folder. Pass the parsed `jwks.json`; it is served as given and the
   * endpoint does not exist without it.
   */
  json?: unknown
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
  /**
   * The exact allowed origin. Never `*`, because these responses carry
   * credentials. It is also the one origin besides the server's own that may
   * make state-changing requests — see the origin check in `createHandler`.
   */
  origin: string
}

/** Options accepted by `createAuthServer`. */
export interface AuthServerOptions {
  /** The callbacks that read and write your database. */
  db: AuthDB
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
  /** Sign-in method: OAuth. */
  providers?: ProvidersOptions
  /** Token signing, lifetime, claims, and the keys local verification accepts. */
  jwt?: JwtOptions
  /** Where the public key set is hosted, or the document to serve it from. */
  jwks?: JwksOptions
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
   * Absolute origin of this server, e.g. `https://app.example.com`.
   *
   * Optional, with no environment variable behind it. Left unset, every origin
   * this server needs — the OAuth `redirect_uri` above all — is derived per
   * request from `X-Forwarded-Host` and `X-Forwarded-Proto`, falling back to the
   * request URL. That is correct for a single-origin app, behind a proxy or not,
   * and a forged host does not become a redirect anywhere: providers only ever
   * redirect to a URI registered in their own console.
   *
   * Set it to pin the canonical origin — a proxy that rewrites the host without
   * forwarding it, or an app answering on several origins that must always name
   * one — and to publish an `issuer`: the discovery document and the `iss` claim
   * need a fixed value, so both are absent without it.
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
   * How the client's IP address is derived from proxy headers — the per-IP
   * rate-limit key and the stored `session.ipAddress`.
   *
   * Works unconfigured on any platform that overwrites `x-forwarded-for`.
   * Declare {@link IpAddressOptions.trustedProxies} when a chain reaches this
   * server, or point {@link IpAddressOptions.headers} at a single-value header
   * your platform controls.
   */
  ipAddress?: IpAddressOptions
  /** Cross-origin access, needed when the client is configured with a different `baseURL`. */
  cors?: CorsOptions
  /** @default "warn" */
  logLevel?: LogLevel
  /** Log sink override, e.g. pino. Defaults to `console`. */
  logger?: Logger
}
