const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

// Uint8Array.toBase64 needs Node 25
/** Encodes raw bytes as standard base64, padded. */
export function bytesToBase64(bytes: Uint8Array) {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)

  return btoa(binary)
}

/**
 * Decodes standard base64 back to raw bytes.
 *
 * @returns The bytes, or `null` when the input is not base64 at all.
 */
export function base64ToBytes(value: string) {
  try {
    const binary = atob(value)
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    return null
  }
}

/** Encodes raw bytes as base64url with no padding. */
export function bytesToBase64url(bytes: Uint8Array) {
  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

/** Encodes a UTF-8 string as base64url, for values that must be cookie-safe. */
export function encodeBase64url(text: string) {
  return bytesToBase64url(textEncoder.encode(text))
}

/**
 * Decodes base64url back to raw bytes.
 *
 * @returns The bytes, or `null` when the input is not base64url at all.
 */
export function base64urlToBytes(value: string) {
  return base64ToBytes(value.replace(/-/g, "+").replace(/_/g, "/"))
}

/**
 * Decodes base64url back to a UTF-8 string.
 *
 * @returns The text, or `null` when the input is not base64url at all — the
 * caller is reading untrusted input and should treat that as a plain mismatch.
 */
export function decodeBase64url(value: string) {
  const bytes = base64urlToBytes(value)
  return bytes === null ? null : textDecoder.decode(bytes)
}
