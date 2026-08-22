import { decodeProtectedHeader } from "jose"
import { describe, expect, it } from "vitest"
import { createTestServer } from "../helpers/create-test-server"
import { generateTestKeys } from "../helpers/generate-test-keys"

/**
 * Walks the documented runbook end to end, from the local verifier's point of
 * view.
 *
 * Each "deploy" is a fresh server over the same key files. The published
 * `jwks.json` is a static file the consumer edits by hand at each step; what is
 * checked here is the promise about its in-process twin — that
 * `authServer.verifyToken()` accepts exactly the signing key plus
 * `additionalPublicKeys`, and so follows the same steps.
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
    const oldToken = await publishing.authServer.signToken({ userId: "user-1" })
    const oldKid = decodeProtectedHeader(oldToken).kid

    // Step 4: switch signing to the new key, keep the old one published.
    const switched = await createTestServer({
      jwt: {
        privateKey: next.privateKeyPem,
        additionalPublicKeys: [old.publicKeyPem]
      }
    })
    const newToken = await switched.authServer.signToken({ userId: "user-1" })
    const newKid = decodeProtectedHeader(newToken).kid

    // A key's kid is its thumbprint, so it does not change when the key moves
    // between roles — which is why the cached step-2 document already names
    // the key new tokens carry.
    expect(oldKid).not.toBe(newKid)
    expect(newKid).toBe(
      decodeProtectedHeader(
        await switched.authServer.signToken({ userId: "user-2" })
      ).kid
    )

    // Local verification follows the published list: the old token, still
    // inside its lifetime, verifies on the switched server, and the new token
    // on the step-2 server.
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

    expect((await cleaned.authServer.verifyToken(newToken))?.sub).toBe("user-1")
    await expect(cleaned.authServer.verifyToken(oldToken)).resolves.toBeNull()
  })

  it("keeps verifying when additionalPublicKeys repeats a key, and says so", async () => {
    // The easy slip at the switch: the new key's public half ends up in
    // additionalPublicKeys alongside being the signing key, or an old one is
    // pasted twice. Two entries with one kid would make jose refuse to choose
    // and fail every local verification; the duplicates are dropped and logged.
    const current = await generateTestKeys("RS256")
    const old = await generateTestKeys("RS256")
    const context = await createTestServer({
      jwt: {
        privateKey: current.privateKeyPem,
        additionalPublicKeys: [
          current.publicKeyPem,
          old.publicKeyPem,
          old.publicKeyPem
        ]
      }
    })

    const token = await context.authServer.signToken({ userId: "user-1" })

    expect((await context.authServer.verifyToken(token))?.sub).toBe("user-1")
    expect(
      context.logCalls.filter(
        (call) =>
          call.level === "warn" &&
          call.message ===
            "ignoring a duplicate key in jwt.additionalPublicKeys"
      )
    ).toHaveLength(2)
  })
})
