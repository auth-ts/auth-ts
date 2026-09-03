import { base64urlToBytes, bytesToBase64url } from "./base64url"

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

/** Marks the format so a later scheme can be told apart from this one. */
const VERSION = "v1"
/** AES-GCM's standard nonce length. Anything else costs an extra derivation step. */
const IV_BYTES = 12

/**
 * Encryption keys, derived once per secret.
 *
 * Deriving is the expensive half, and the secret does not change between
 * requests. Keyed by the secret string because one process may serve several
 * tenants; the map grows to the number of distinct secrets and no further.
 */
const keys = new Map<string, Promise<CryptoKey>>()

function encryptionKey(secret: string) {
  let key = keys.get(secret)
  if (!key) {
    key = (async () => {
      const material = await crypto.subtle.importKey(
        "raw",
        textEncoder.encode(secret),
        "HKDF",
        false,
        ["deriveKey"]
      )

      return crypto.subtle.deriveKey(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: new Uint8Array(0),
          info: textEncoder.encode("auth-ts.provider-tokens")
        },
        material,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      )
    })()
    keys.set(secret, key)
    key.catch(() => keys.delete(secret))
  }
  return key
}

/**
 * Encrypts a value that has to be presented back to somebody else later.
 *
 * Provider access and refresh tokens are stored this way. They cannot be hashed
 * the way this library's own credentials are — Google will not accept a digest
 * of its refresh token — so the next best property is that a leaked database is
 * inert without the server secret.
 *
 * AES-256-GCM, so tampering is detected rather than decrypted into something
 * else, under a key derived from `secret` alone: rotating the secret makes every
 * stored token unreadable, which surfaces as "reconnect this account", never as
 * a wrong token sent to a provider.
 *
 * @returns `v1.<iv>.<ciphertext>`, both base64url.
 */
export async function encryptSecret(secret: string, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(secret),
    textEncoder.encode(value)
  )

  return `${VERSION}.${bytesToBase64url(iv)}.${bytesToBase64url(new Uint8Array(sealed))}`
}

/**
 * Decrypts what {@link encryptSecret} wrote.
 *
 * @returns The plaintext, or `null` for anything this secret cannot open —
 * a value written under a rotated secret, a truncated column, a format from
 * another version, or a row somebody edited. Every one of those means the same
 * thing to the caller: there is no usable token here.
 */
export async function decryptSecret(secret: string, value: string) {
  const [version, encodedIv, encodedCiphertext] = value.split(".")
  if (version !== VERSION || !encodedIv || !encodedCiphertext) return null

  const iv = base64urlToBytes(encodedIv)
  const ciphertext = base64urlToBytes(encodedCiphertext)
  if (!iv || !ciphertext) return null

  try {
    const opened = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      await encryptionKey(secret),
      ciphertext
    )
    return textDecoder.decode(opened)
  } catch {
    return null
  }
}
