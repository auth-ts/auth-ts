const textEncoder = new TextEncoder()

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * Hashes a value with SHA-256 and returns lowercase hex.
 *
 * Refresh tokens are stored this way, so a leaked table cannot be replayed as a
 * session. That is all it buys: the hash is unkeyed, so anyone holding a token
 * can find its row, and the token stays a bearer credential either way. Thirty
 * two random bytes need no key — six-digit codes do, which is why those get
 * {@link hmacSha256Hex} instead.
 */
export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(value)
  )
  return toHex(digest)
}

/**
 * HMAC keys, imported once per secret.
 *
 * Importing a raw key is the expensive half of an HMAC, and the secret does not
 * change between requests — so it is done on first use and kept. Keyed by the
 * secret string because one process may serve several tenants, each with its
 * own; the map grows to the number of distinct secrets it has seen and no
 * further. The secret is already in memory in the resolved config, so holding
 * the imported key beside it reveals nothing new.
 */
const hmacKeys = new Map<string, Promise<CryptoKey>>()

function hmacKey(secret: string) {
  let key = hmacKeys.get(secret)
  if (!key) {
    key = crypto.subtle.importKey(
      "raw",
      textEncoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    )
    hmacKeys.set(secret, key)
    // A failed import must not be cached as a permanently rejected promise.
    key.catch(() => hmacKeys.delete(secret))
  }
  return key
}

/**
 * Signs a value with HMAC-SHA-256 under the server secret and returns lowercase hex.
 *
 * Magic codes are stored this way rather than as a bare hash. Six digits is only
 * a million possibilities, so a plain SHA-256 of a code is reversible from a
 * database read in about a second; keying the hash with a secret the database
 * never holds means a database leak alone does not yield working codes.
 */
export async function hmacSha256Hex(value: string, secret: string) {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    textEncoder.encode(value)
  )
  return toHex(signature)
}

/**
 * Compares two hex digests in time that does not depend on where they differ.
 *
 * A `===` here would return as soon as it found a mismatching character, and the
 * timing of that return leaks how much of a guess was correct.
 */
export function timingSafeEqualHex(left: string, right: string) {
  if (left.length !== right.length) return false

  let difference = 0
  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }

  return difference === 0
}
