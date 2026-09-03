import { bytesToBase64url } from "../lib/base64url"
import { randomBytesBase64url } from "../lib/generate-random"

const textEncoder = new TextEncoder()

/**
 * Generates a PKCE code verifier.
 *
 * Thirty-two random bytes, base64url — 43 characters, inside RFC 7636 §4.1's
 * 43–128 and drawn from exactly the alphabet it allows. It lives only in the
 * signed, `HttpOnly` state cookie, so nothing but this server ever sees it
 * before it is sent to the provider's token endpoint.
 */
export function createCodeVerifier() {
  return randomBytesBase64url(32)
}

/**
 * Derives the S256 code challenge: `base64url(sha256(ascii(verifier)))`.
 *
 * Always S256, never `plain`: the challenge goes in a URL the browser carries
 * through the provider, and the whole point is that seeing it does not give
 * away the verifier. A provider that is handed the challenge refuses to
 * exchange an authorization code without the matching verifier — so a code
 * intercepted on the way back is worthless to whoever intercepted it, which is
 * what the signed state does not cover on its own.
 */
export async function codeChallengeS256(verifier: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(verifier)
  )
  return bytesToBase64url(new Uint8Array(digest))
}
