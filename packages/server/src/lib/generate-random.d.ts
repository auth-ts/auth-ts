/**
 * Generates cryptographically random bytes and encodes them base64url.
 *
 * Used for refresh tokens and OAuth `state`. Web Crypto only — this module must
 * stay importable on edge runtimes, so there is no `node:crypto` fallback.
 *
 * @param byteLength - How many random bytes to draw. Refresh tokens use 32.
 */
export declare function randomBytesBase64url(byteLength: number): string;
/**
 * Generates a uniformly distributed six-digit magic code as a zero-padded string.
 *
 * Rejection sampling, not `value % 1000000`: the modulo of a 32-bit draw favours
 * the low end of the range, and a biased code space is a smaller code space.
 * Never `Math.random()` — it is not a CSPRNG and this value is a credential.
 */
export declare function randomSixDigitCode(): string;
/** Generates a RFC 4122 v4 UUID, used for session row ids. */
export declare function randomUUID(): `${string}-${string}-${string}-${string}-${string}`;
//# sourceMappingURL=generate-random.d.ts.map