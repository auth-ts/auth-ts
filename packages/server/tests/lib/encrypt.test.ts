import { describe, expect, it } from "vitest"
import { decryptSecret, encryptSecret } from "../../src/lib/encrypt"

const SECRET = "a-server-secret-of-perfectly-ordinary-length"

describe("encryptSecret", () => {
  it("round-trips a value under the same secret", async () => {
    const sealed = await encryptSecret(SECRET, "ya29.a0AfB_provider-token")

    expect(sealed).not.toContain("ya29")
    expect(await decryptSecret(SECRET, sealed)).toBe(
      "ya29.a0AfB_provider-token"
    )
  })

  it("never produces the same ciphertext twice", async () => {
    // A fresh IV per call, so equal provider tokens are not equal columns —
    // otherwise the table shows which users share a grant.
    const [first, second] = await Promise.all([
      encryptSecret(SECRET, "same-token"),
      encryptSecret(SECRET, "same-token")
    ])

    expect(first).not.toBe(second)
    expect(await decryptSecret(SECRET, second)).toBe("same-token")
  })

  it("refuses a value that was tampered with", async () => {
    // GCM authenticates the ciphertext, so an edited column fails to open
    // rather than decrypting into something the provider would be sent.
    const sealed = await encryptSecret(SECRET, "provider-token")
    const flipped = `${sealed.slice(0, -2)}${sealed.endsWith("aa") ? "bb" : "aa"}`

    expect(await decryptSecret(SECRET, flipped)).toBeNull()
  })

  it("refuses a value written under a different secret", async () => {
    // What a rotated secret looks like: unreadable, never wrong. The caller
    // reads null as "reconnect this account".
    const sealed = await encryptSecret(SECRET, "provider-token")

    expect(await decryptSecret(`${SECRET}-rotated`, sealed)).toBeNull()
  })

  it("refuses anything that is not this format", async () => {
    for (const value of ["", "plaintext", "v2.aa.bb", "v1.aa", "v1..bb"]) {
      expect(await decryptSecret(SECRET, value)).toBeNull()
    }
  })
})
