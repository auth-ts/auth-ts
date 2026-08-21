import type { LocalizationOptions } from "../http/get-error-message.ts";
import type { JwtAlgorithm } from "../jwt/import-signing-key.ts";
import type { Logger, LogLevel } from "../lib/logger.ts";
import type { Duration } from "../lib/parse-duration.ts";
import type { AuthDb } from "./auth-db.ts";
/** Everything a send callback is told about the code it is delivering. */
export interface SendCodeContext {
    /** The six-digit code, in plain text. Deliver it; never store it. */
    code: string;
    /**
     * The locale core already resolved for this request. Use it as-is rather than
     * re-deriving one, so the email matches the error messages the user is seeing.
     */
    locale: string;
    /**
     * The request's headers — not the `Request`, whose body has already been read
     * and would throw on a second read.
     *
     * Everything a sender legitimately needs is here: `Host` for multi-tenant
     * branding, `User-Agent` for a "new device" note.
     */
    headers: Headers;
    /** Why the code was sent, so deletion mail can differ from sign-in mail. */
    purpose: "signIn" | "deleteUser";
}
/** Email delivery. Supplying this enables email as a sign-in method. */
export interface EmailOptions {
    sendCode(context: SendCodeContext & {
        email: string;
    }): Promise<void> | void;
}
/** SMS delivery. Supplying this enables phone as a sign-in method. */
export interface SmsOptions {
    sendCode(context: SendCodeContext & {
        phoneNumber: string;
    }): Promise<void> | void;
}
/** Client credentials for one OAuth provider. */
export interface ProviderCredentials {
    clientId: string;
    clientSecret: string;
}
/** The OAuth providers shipped in v1. Adding more is configuration, not new endpoints. */
export interface ProvidersOptions {
    github?: ProviderCredentials;
    google?: ProviderCredentials;
}
/** Token signing and publication. */
export interface JwtOptions {
    /**
     * PKCS#8 private key PEM. Defaults to the `JWT_PRIVATE_KEY` environment
     * variable; construction throws if neither is set.
     */
    privateKey?: string;
    /** @default "RS256" */
    alg?: JwtAlgorithm;
    /** Access-token lifetime, which is also the revocation latency. @default "10m" */
    ttl?: Duration;
    /** Merged into every token, under the caller's own claims. @default { role: "authenticated" } */
    claims?: Record<string, unknown>;
    /** Key id in the JWKS and the token header. @default "main" */
    kid?: string;
    /**
     * Sets `aud` and makes verification enforce it.
     *
     * Unset by default: Neon and Supabase both accept tokens without an audience,
     * and a default value only creates a mismatch to debug.
     */
    audience?: string;
    /** SPKI PEM public keys to publish alongside the current one during rotation. */
    additionalPublicKeys?: string[];
}
/** Refresh-token lifetime. */
export interface SessionOptions {
    /** @default "30d" */
    ttl?: Duration;
    /** Extend expiry on each refresh. @default true */
    sliding?: boolean;
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
    name?: string;
    /**
     * Defaults to `basePath`, so the token is sent only to the auth mount.
     *
     * Set `"/"` when server-side rendering needs the session on page requests —
     * with the tradeoff that the refresh token then rides the `Cookie` header of
     * every same-origin request, and therefore into access logs and APM traces.
     */
    path?: string;
}
/** The primitive types an additional field may hold. */
export type AdditionalFieldType = "string" | "number" | "boolean";
/** Declared additional fields, as a name → type map. */
export type AdditionalFieldsSchema = Record<string, AdditionalFieldType>;
/** User-record behaviour. */
export interface UserOptions {
    /**
     * Extra fields your table has that sign-up may set and `PATCH /user` may edit.
     *
     * An allowlist, not a schema: undeclared keys in a request are rejected, and
     * declared fields are applied **on insert only** so that signing in cannot
     * overwrite an existing profile.
     */
    additionalFields?: AdditionalFieldsSchema;
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
    deleteFreshWindow?: Duration;
}
/** One fixed-window rate limit. */
export interface RateLimitWindow {
    max: number;
    window: Duration;
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
    sendCodePerIdentifier?: RateLimitWindow;
    /** @default { max: 30, window: "10m" } */
    sendCodePerIP?: RateLimitWindow;
    /**
     * Protects the population rather than one code: blocks cross-identifier
     * spraying and code-burning griefing, and bounds the non-atomic attempt count.
     * @default { max: 30, window: "10m" }
     */
    verifyCodePerIP?: RateLimitWindow;
    /** @default { max: 3, window: "10m" } */
    deleteUserPerIdentifier?: RateLimitWindow;
    /** @default { max: 30, window: "10m" } */
    guestPerIP?: RateLimitWindow;
    /**
     * Minimum spacing between sends to one identifier.
     *
     * Windows cap volume; this caps rapid-fire. Derived from the live code's
     * `expiresAt` minus the code TTL, so it adds no state and no callback.
     * @default "60s"
     */
    sendCodeCooldown?: Duration;
}
/** Cross-origin access, for a client configured with a different `baseURL`. */
export interface CorsOptions {
    /** The exact allowed origin. Never `*`, because these responses carry credentials. */
    origin: string;
}
/** Options accepted by `createAuthServer`. */
export interface AuthServerOptions {
    /** The callbacks that read and write your database. */
    db: AuthDb;
    /** Sign-in method: magic codes over email. */
    email?: EmailOptions;
    /** Sign-in method: magic codes over SMS. */
    sms?: SmsOptions;
    /**
     * Enables `POST /sign-in/guest`.
     *
     * Off by default because anonymous account creation is an attack surface you
     * should opt into; it is per-IP rate limited even when on.
     * @default false
     */
    guest?: boolean;
    /** Sign-in method: OAuth. Requires {@link AuthServerOptions.baseURL}. */
    providers?: ProvidersOptions;
    /** Token signing, lifetime, claims, and key publication. */
    jwt?: JwtOptions;
    /**
     * Server secret that keys the magic-code HMAC. Defaults to the `AUTH_SECRET`
     * environment variable.
     *
     * Must not be the JWT key: different type, different blast radius, rotated
     * independently.
     */
    secret?: string;
    /** Where the handlers are mounted. Drives cookie path and OAuth callback URLs. @default "/api/auth" */
    basePath?: string;
    /**
     * Absolute origin of this server. **Required when `providers` is set**, because
     * an OAuth `redirect_uri` must never be derived from a request header an
     * attacker can set.
     */
    baseURL?: string;
    /** Refresh-token lifetime and whether it slides on use. */
    session?: SessionOptions;
    /** Refresh-cookie name and scope. Security attributes are fixed, not options. */
    cookie?: CookieOptions;
    /** Additional user fields and the account-deletion freshness window. */
    user?: UserOptions;
    /** Set `false` to disable the built-in limiter and bring your own. */
    rateLimit?: RateLimitOptions | false;
    /**
     * Google-style account switching: several users signed in to one browser.
     *
     * Named for what it multiplies — accounts per browser. Sessions per user are
     * already plural; that is the devices list.
     * @default false
     */
    multiAccount?: boolean;
    /**
     * Sweep expired rows after every mutating flow, fire and forget.
     *
     * Hygiene, never a security boundary: expiry is enforced on read regardless.
     * @default true
     */
    cleanup?: boolean;
    /** Server-side localization of error messages. Codes stay stable; only messages translate. */
    localization?: LocalizationOptions;
    /** Cross-origin access, needed when the client is configured with a different `baseURL`. */
    cors?: CorsOptions;
    /** @default "warn" */
    logLevel?: LogLevel;
    /** Log sink override, e.g. pino. Defaults to `console`. */
    logger?: Logger;
}
/** Options after defaults, environment lookups, and validation. */
export interface ResolvedAuthServerOptions {
    db: AuthDb;
    email?: EmailOptions;
    sms?: SmsOptions;
    guest: boolean;
    providers: ProvidersOptions;
    jwt: Required<Pick<JwtOptions, "privateKey" | "alg" | "ttl" | "claims" | "kid">> & Pick<JwtOptions, "audience" | "additionalPublicKeys">;
    secret: string;
    basePath: string;
    baseURL?: string;
    issuer?: string;
    session: Required<SessionOptions>;
    cookie: {
        name: string;
        path: string;
        accountsName: string;
        stateName: string;
    };
    user: {
        additionalFields: AdditionalFieldsSchema;
        deleteFreshWindow: Duration;
    };
    rateLimit: Required<RateLimitOptions> | false;
    multiAccount: boolean;
    cleanup: boolean;
    localization?: LocalizationOptions;
    cors?: CorsOptions;
    logLevel: LogLevel;
    logger?: Logger;
}
/**
 * Field names core owns, which therefore cannot be declared as additional fields.
 *
 * `name` and `imageURL` are included because `PATCH /user` takes a flat body: if
 * an additional field shared one of those names, the two would collide silently.
 * `locale` is deliberately *not* reserved — core stores no locale, so declaring
 * one as an additional field is exactly how you persist a preference.
 */
export declare const RESERVED_USER_FIELDS: readonly ["id", "email", "phoneNumber", "type", "primaryUserId", "name", "imageURL"];
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
export declare function resolveAuthServerOptions(options: AuthServerOptions): ResolvedAuthServerOptions;
//# sourceMappingURL=auth-server-options.d.ts.map