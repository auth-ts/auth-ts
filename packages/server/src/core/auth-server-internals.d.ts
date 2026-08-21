import type { JWK } from "jose";
import type { SigningKeyMaterial } from "../jwt/import-signing-key.ts";
import type { LeveledLogger } from "../lib/logger.ts";
import type { AuthDb } from "./auth-db.ts";
import type { ResolvedAuthServerOptions } from "./auth-server-options.ts";
/** Key material, imported once on first use. */
export interface KeyMaterial extends SigningKeyMaterial {
    /** Public keys published alongside the signing key during rotation. */
    additionalPublicJwks: JWK[];
}
/**
 * The four things every internal function needs, passed as one argument.
 *
 * A plain struct, not a framework concept: nothing is provided or consumed, and
 * there is no lifecycle. It exists because `issueSession(internals, …)` reads
 * better than four separate parameters threaded through every call, and because
 * having it in a leaf module lets the endpoints import the type without a cycle
 * back to `createAuthServer`.
 */
export interface AuthServerInternals {
    options: ResolvedAuthServerOptions;
    db: AuthDb;
    log: LeveledLogger;
    /**
     * Imports the key material, memoized.
     *
     * Lazy because importing a PKCS#8 key is asynchronous while construction is
     * not: `createAuthServer` stays a synchronous call that does no input/output,
     * and the key is imported on the first sign or verify.
     */
    keys(): Promise<KeyMaterial>;
}
/** Builds the internals struct from resolved options. */
export declare function createAuthServerInternals(options: ResolvedAuthServerOptions): AuthServerInternals;
//# sourceMappingURL=auth-server-internals.d.ts.map