import type { JWK } from "jose";
/**
 * The signing algorithm.
 *
 * Both are accepted by Neon and Supabase. RS256 is the default for the widest
 * verifier compatibility; ES256 produces smaller signatures and is one line to
 * switch to. Symmetric algorithms are structurally impossible here — a JWKS
 * endpoint cannot publish an HMAC secret without publishing the ability to forge.
 */
export type JwtAlgorithm = "RS256" | "ES256";
/** An imported key pair: what signs, what verifies, and what gets published. */
export interface SigningKeyMaterial {
    /** Private key — signs tokens, never leaves the server. */
    signingKey: CryptoKey;
    /**
     * Public key — verifies tokens.
     *
     * Separate from {@link SigningKeyMaterial.signingKey} because Web Crypto
     * requires it to be: `verify` rejects a private key outright.
     */
    verificationKey: CryptoKey;
    /** The public JWK, already carrying `kid`, `alg`, and `use`. */
    publicJwk: JWK;
}
/**
 * Imports a PKCS#8 private key and derives the public JWK to serve from JWKS.
 *
 * The key is imported as extractable so the public half can be derived from it,
 * which keeps configuration to a single secret — supplying the public key
 * separately would create a way for the two to disagree, and a JWKS that does not
 * match the signing key fails only at the verifier, far from the mistake.
 *
 * @throws {Error} If the PEM cannot be parsed as a key for this algorithm.
 */
export declare function importSigningKey(privateKeyPem: string, algorithm: JwtAlgorithm, kid: string): Promise<SigningKeyMaterial>;
/**
 * Imports an additional public key (SPKI PEM) to publish alongside the current one.
 *
 * Used during rotation. Its `kid` is the JWK thumbprint rather than a
 * configured name: these keys are only ever verified against, never signed with,
 * so a stable value derived from the key itself is both sufficient and impossible
 * to get wrong.
 */
export declare function importAdditionalPublicKey(publicKeyPem: string, algorithm: JwtAlgorithm): Promise<JWK>;
//# sourceMappingURL=import-signing-key.d.ts.map