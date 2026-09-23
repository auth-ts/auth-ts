import { base64urlToBytes, bytesToBase64url } from "../shared/base64url"

const textEncoder = new TextEncoder()

/** Lowercase hex of a digest, the form every hash column stores. */
export function toHex(buffer: ArrayBuffer | Uint8Array) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

/** The bytes a {@link toHex} string encodes. */
export function hexToBytes(hex: string) {
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) =>
    Number.parseInt(pair, 16)
  )
}

/**
 * Hashes a value with SHA-256 and returns lowercase hex.
 *
 * Session secrets and attempt tokens are stored this way, so a leaked table
 * cannot be replayed. That is all it buys: the hash is unkeyed, and the token
 * stays a bearer credential either way. Thirty-two random bytes need no
 * slowing down — short codes do, which is why those get {@link scryptHash}
 * instead.
 */
export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(value)
  )
  return toHex(digest)
}

/**
 * The scrypt cost a code is stored under: 16 MiB, the memory the book's Argon2
 * recommendation asks for, at one lane so throughput is the server's.
 */
const SCRYPT = { ln: 14, r: 8, p: 1, keyLength: 32 }

/**
 * Derives an scrypt key. `node:crypto` is loaded on first use rather than at
 * import, so the package still loads where only Web Crypto exists — only the
 * code flow needs Node, Bun, Deno, or Workers with Node compatibility.
 */
export async function scryptDerive(
  value: string,
  salt: Uint8Array,
  cost: { ln: number; r: number; p: number },
  keyLength: number
): Promise<Uint8Array> {
  const { scrypt } = await import("node:crypto")
  const N = 2 ** cost.ln

  return new Promise((resolve, reject) => {
    scrypt(
      textEncoder.encode(value),
      salt,
      keyLength,
      { N, r: cost.r, p: cost.p, maxmem: 256 * N * cost.r },
      (error, key) => (error ? reject(error) : resolve(new Uint8Array(key)))
    )
  })
}

/**
 * Hashes a verification code with scrypt and returns a PHC-style string.
 *
 * A short code has few enough values that a fast hash of it is reversible
 * from a database read in seconds, keyed or not once the key leaks. scrypt at
 * 16 MiB makes each guess cost real memory and time, so a leaked table cannot
 * be reversed before its codes expire, and nothing else has to stay secret for
 * that to hold. The parameters travel in the string so they can be raised
 * without a migration.
 */
export async function scryptHash(value: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await scryptDerive(value, salt, SCRYPT, SCRYPT.keyLength)

  return `$scrypt$ln=${SCRYPT.ln},r=${SCRYPT.r},p=${SCRYPT.p}$${bytesToBase64url(salt)}$${bytesToBase64url(key)}`
}

/** Whether `value` is the code a {@link scryptHash} string was made from. */
export async function scryptVerify(value: string, stored: string) {
  const match =
    /^\$scrypt\$ln=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(
      stored
    )
  if (!match) return false
  const [, ln = "", r = "", p = "", encodedSalt = "", encodedKey = ""] = match
  const salt = base64urlToBytes(encodedSalt)
  const expected = base64urlToBytes(encodedKey)
  if (!salt || !expected) return false

  const derived = await scryptDerive(
    value,
    salt,
    { ln: Number(ln), r: Number(r), p: Number(p) },
    expected.length
  )

  return constantTimeEqual(derived, expected)
}

// Lucia's auth_session.ts, 0BSD
/**
 * Compares two digests in time that does not depend on where they differ.
 *
 * A `===` here would return as soon as it found a mismatching byte, and the
 * timing of that return leaks how much of a guess was correct.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false
  }
  let c = 0
  for (let i = 0; i < a.byteLength; i++) {
    c |= (a[i] ?? 0) ^ (b[i] ?? 0)
  }
  return c === 0
}
