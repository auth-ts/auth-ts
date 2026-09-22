import type { OAuthStatePayload } from "../../src/oauth/state-cookie"
import { encodeStatePayload } from "../../src/oauth/state-cookie"
import { decodeBase64url } from "../../src/shared/base64url"

/** Reads the payload out of a state cookie. */
export function decodeState(value: string) {
  return JSON.parse(decodeBase64url(value) ?? "null") as OAuthStatePayload
}

/** Encodes an arbitrary payload the way the server would — for tamper tests. */
export function forgeState(payload: OAuthStatePayload) {
  return encodeStatePayload(payload)
}
