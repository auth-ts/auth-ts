const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

/** Encodes raw bytes as base64url with no padding. */
export function bytesToBase64url(bytes: Uint8Array) {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** Encodes a UTF-8 string as base64url, for values that must be cookie-safe. */
export function encodeBase64url(text: string) {
  return bytesToBase64url(textEncoder.encode(text))
}

/**
 * Decodes base64url back to a UTF-8 string.
 *
 * @returns The text, or `null` when the input is not base64url at all — the
 * caller is reading untrusted input and should treat that as a plain mismatch.
 */
export function decodeBase64url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
  try {
    const binary = atob(base64)
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0)
    )
    return textDecoder.decode(bytes)
  } catch {
    return null
  }
}
