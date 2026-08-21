import type { UserType } from "../core/auth-db.ts";
import type { JwtAlgorithm } from "./import-signing-key.ts";
/** A verified token's claims. */
export interface TokenClaims {
    /** The user id, absent on service tokens minted without one. */
    sub?: string;
    type?: UserType;
    role?: string;
    iss?: string;
    aud?: string | string[];
    iat: number;
    exp: number;
    [claim: string]: unknown;
}
/** What {@link verifyToken} needs, resolved from the server options. */
export interface VerifyTokenContext {
    /** The public key. Web Crypto cannot verify with a private key. */
    verificationKey: CryptoKey;
    algorithm: JwtAlgorithm;
    issuer?: string;
    audience?: string;
}
/**
 * Verifies a token locally — no database, no network.
 *
 * The algorithm allowlist is exactly the configured algorithm, which is what
 * closes algorithm confusion: a token whose header claims `HS256`, signed using
 * the public key as an HMAC secret, is rejected before its signature is even
 * considered. `iss` and `aud` are enforced only when configured, so a deployment
 * that sets neither is not silently accepting tokens meant for somewhere else —
 * it simply has no such constraint to check.
 *
 * A 60 second clock tolerance absorbs skew between machines. It does not accept
 * expired tokens: it acknowledges that two servers rarely agree on the second,
 * and without it a valid token fails on whichever host is running slightly fast.
 *
 * @returns The claims, or `null` for any failure at all — bad signature, wrong
 * algorithm, wrong audience or issuer, expired, or malformed. Callers get one
 * thing to check rather than a taxonomy of ways to be unauthenticated.
 */
export declare function verifyToken(context: VerifyTokenContext, token: string): Promise<TokenClaims | null>;
//# sourceMappingURL=verify-token.d.ts.map