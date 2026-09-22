import { bytesToBase64url } from "../shared/base64url"

/**
 * Generates cryptographically random bytes and encodes them base64url.
 *
 * Used for refresh tokens and OAuth `state`. Web Crypto only — this module must
 * stay importable on edge runtimes, so there is no `node:crypto` fallback.
 *
 * @param byteLength - How many random bytes to draw. Refresh tokens use 32.
 */
export function randomBytesBase64url(byteLength: number) {
  return bytesToBase64url(crypto.getRandomValues(new Uint8Array(byteLength)))
}

/**
 * The symbols a verification code is drawn from.
 *
 * `alphanumeric` is uppercase letters and digits without I, O, 0 and 1, which
 * are the pairs people misread: thirty-two symbols, five bits each.
 */
export const CODE_ALPHABETS = {
  alphanumeric: "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",
  numeric: "0123456789"
} as const

/** Which of {@link CODE_ALPHABETS} a code is drawn from. */
export type CodeAlphabet = keyof typeof CODE_ALPHABETS

/**
 * Generates a verification code of `length` symbols drawn uniformly from an alphabet.
 *
 * One random byte per symbol, masked to the alphabet's bit width and rejected
 * when it lands past the last symbol — not `byte % size`, which favours the
 * low end and shrinks the code space. Never `Math.random()` — it is not a
 * CSPRNG and this value is a credential.
 */
export function randomCode(alphabet: CodeAlphabet, length: number) {
  const symbols = CODE_ALPHABETS[alphabet]
  const mask = (1 << Math.ceil(Math.log2(symbols.length))) - 1

  let code = ""
  while (code.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length))) {
      const index = byte & mask
      if (index < symbols.length && code.length < length) {
        code += symbols[index]
      }
    }
  }

  return code
}
