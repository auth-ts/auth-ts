import { decodeProtectedHeader } from "jose"
import { describe, expect, it } from "vitest"
import { createTestServer } from "../helpers/create-test-server.ts"
import { generateTestKeys } from "../helpers/generate-test-keys.ts"

/**
 * Walks the documented runbook end to end, from the verifier's point of view.
 *
 * Each "deploy" is a fresh server over the same key files. Both things the
 * runbook promises are checked at every step: what `jwks.json` publishes, and
 * what local `authServer.verifyToken()` accepts — which must be the same set.
 */
describe("key rotation", () => {
  it("keeps old and new tokens verifiable across the switch, then drops the old key cleanly", async () => {
    const old = await generateTestKeys("RS256")
    const next = await generateTestKeys("RS256")

    // Step 2: publish both, still signing with the old key.
    const publishing = await createTestServer({
      jwt: {
        privateKey: old.privateKeyPem,
        additionalPublicKeys: [next.publicKeyPem]
      }
    })
    const publishedJwks = await publishing.authServer.getJwks(
      undefined as never
    )
    const oldToken = await publishing.authServer.signToken({ userId: "user-1" })
    const oldKid = decodeProtectedHeader(oldToken).kid

    // Step 4: switch signing to the new key, keep the old one published.
    const switched = await createTestServer({
      jwt: {
        privateKey: next.privateKeyPem,
        additionalPublicKeys: [old.publicKeyPem]
      }
    })
    const switchedJwks = await switched.authServer.getJwks(undefined as never)
    const newToken = await switched.authServer.signToken({ userId: "user-1" })
    const newKid = decodeProtectedHeader(newToken).kid

    // A key's kid does not change when it moves between roles, so the two
    // documents publish the same two kids — only the order (who signs) differs.
    const kidsOf = (jwks: { keys: Array<{ kid?: string }> }) =>
      jwks.keys.map((key) => key.kid).sort()
    expect(kidsOf(publishedJwks)).toEqual(kidsOf(switchedJwks))
    expect(oldKid).not.toBe(newKid)
    expect(switchedJwks.keys[0]?.kid).toBe(newKid)
    expect(switchedJwks.keys[1]?.kid).toBe(oldKid)

    // A verifier that cached the step-2 document already knows the new key by
    // the kid new tokens carry — that is what the step-3 wait is for.
    expect(publishedJwks.keys.some((key) => key.kid === newKid)).toBe(true)

    // Local verification follows the same list: the old token, still inside
    // its lifetime, verifies on the switched server, and the new token on the
    // step-2 server.
    expect((await switched.authServer.verifyToken(oldToken))?.sub).toBe(
      "user-1"
    )
    expect((await switched.authServer.verifyToken(newToken))?.sub).toBe(
      "user-1"
    )
    expect((await publishing.authServer.verifyToken(newToken))?.sub).toBe(
      "user-1"
    )

    // Final step: remove the old key. Its tokens stop verifying immediately —
    // which is why the runbook waits one more lifetime first.
    const cleaned = await createTestServer({
      jwt: { privateKey: next.privateKeyPem }
    })
    const cleanedJwks = await cleaned.authServer.getJwks(undefined as never)

    expect(cleanedJwks.keys.map((key) => key.kid)).toEqual([newKid])
    expect((await cleaned.authServer.verifyToken(newToken))?.sub).toBe("user-1")
    await expect(cleaned.authServer.verifyToken(oldToken)).resolves.toBeNull()
  })
})
