/**
 * Hashes a value with SHA-256 and returns lowercase hex.
 *
 * Refresh tokens are stored this way: the database only ever sees the hash, so
 * a leaked table cannot be replayed as a session, and a leaked token cannot be
 * found in the table without also knowing it.
 */
export declare function sha256Hex(value: string): Promise<string>
/**
 * Signs a value with HMAC-SHA-256 under the server secret and returns lowercase hex.
 *
 * Magic codes are stored this way rather than as a bare hash. Six digits is only
 * a million possibilities, so a plain SHA-256 of a code is reversible from a
 * database read in about a second; keying the hash with a secret the database
 * never holds means a database leak alone does not yield working codes.
 */
export declare function hmacSha256Hex(
  value: string,
  secret: string
): Promise<string>
/**
 * Compares two hex digests in time that does not depend on where they differ.
 *
 * A `===` here would return as soon as it found a mismatching character, and the
 * timing of that return leaks how much of a guess was correct.
 */
export declare function timingSafeEqualHex(left: string, right: string): boolean
//# sourceMappingURL=hash.d.ts.map
