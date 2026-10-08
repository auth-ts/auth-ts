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

/** SHA-256 of a value, as lowercase hex. */
export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(value)
  )
  return toHex(digest)
}

// 16 MiB, the book's Argon2 memory
const SCRYPT = { ln: 14, r: 8, p: 1, keyLength: 32 }

/** Derives an scrypt key. */
export async function scryptDerive(
  value: string,
  salt: Uint8Array,
  cost: { ln: number; r: number; p: number },
  keyLength: number
): Promise<Uint8Array> {
  // Lazy, so Web Crypto-only runtimes still load
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

/** Hashes a code with scrypt into a PHC-style string. */
export async function scryptHash(value: string) {
  const salt = crypto.getRandomValues(new Uint8Array(32))
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
/** Compares two digests in constant time. */
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
