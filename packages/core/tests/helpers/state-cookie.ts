import { decodeBase64url } from "../../src/lib/base64url"
import type { OAuthStatePayload } from "../../src/oauth/state-cookie"
import { signStatePayload } from "../../src/oauth/state-cookie"

/** The secret `createTestServer` configures, so tests can mint valid cookies. */
export const TEST_SERVER_SECRET = "test-server-secret-long-enough-to-pass"

/** Reads the payload out of a state cookie without checking its signature. */
export function decodeState(value: string) {
  const encoded = value.slice(0, value.lastIndexOf("."))
  return JSON.parse(decodeBase64url(encoded) ?? "null") as OAuthStatePayload
}

/** Signs an arbitrary payload the way the server would — for tamper tests. */
export function forgeState(
  payload: OAuthStatePayload,
  secret = TEST_SERVER_SECRET
) {
  return signStatePayload(payload, secret)
}
