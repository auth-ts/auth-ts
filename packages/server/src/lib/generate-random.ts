/**
 * Generates cryptographically random bytes and encodes them base64url.
 *
 * Used for refresh tokens and OAuth `state`. Web Crypto only — this module must
 * stay importable on edge runtimes, so there is no `node:crypto` fallback.
 *
 * @param byteLength - How many random bytes to draw. Refresh tokens use 32.
 */
export function randomBytesBase64url(byteLength: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength))

  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/**
 * Generates a uniformly distributed six-digit magic code as a zero-padded string.
 *
 * Rejection sampling, not `value % 1000000`: the modulo of a 32-bit draw favours
 * the low end of the range, and a biased code space is a smaller code space.
 * Never `Math.random()` — it is not a CSPRNG and this value is a credential.
 */
export function randomSixDigitCode() {
  const LIMIT = 1_000_000
  // Largest multiple of LIMIT that fits in 2^32, so anything above it is rejected.
  const CEILING = Math.floor(0xffff_ffff / LIMIT) * LIMIT

  let value = CEILING
  while (value >= CEILING) {
    const [drawn = 0] = crypto.getRandomValues(new Uint32Array(1))
    value = drawn
  }

  return String(value % LIMIT).padStart(6, "0")
}

/** Generates a RFC 4122 v4 UUID, used for session row ids. */
export function randomUUID() {
  return crypto.randomUUID()
}
