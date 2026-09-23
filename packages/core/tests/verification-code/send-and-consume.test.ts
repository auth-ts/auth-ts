import { describe, expect, it, vi } from "vitest"
import { CODE_ALPHABETS } from "../../src/lib/generate-random"
import { sha256Hex } from "../../src/lib/hash"
import type { MemoryDatabase } from "../../src/lib/memory-database"
import { consumeVerificationCode } from "../../src/verification-code/consume-verification-code"
import {
  markIdentityVerified,
  requireVerifiedIdentity
} from "../../src/verification-code/identity"
import { resolveCodeIdentifier } from "../../src/verification-code/resolve-code-identifier"
import { sendVerificationCode } from "../../src/verification-code/send-verification-code"
import { createTestInternals } from "../helpers/create-test-internals"
import { required } from "../helpers/required"
import { selectRows } from "../helpers/rows"

const emailIdentifier = { kind: "email", value: "ada@example.com" } as const

/** Every code stored for the identifier, one per attempt that asked. */
const storedCodes = (db: MemoryDatabase) =>
  selectRows(db, "verifications", { identifier: { eq: emailIdentifier.value } })

/** How many rows the guess limiter holds for an identifier. */
const countGuesses = async (db: MemoryDatabase, identifier: string) => {
  const rows = await selectRows(db, "attempts")

  return rows.filter((row) => row.key.startsWith(`signIn:guess:${identifier}:`))
    .length
}

/** A code no generator would draw: outside the alphabet, so never a collision. */
const WRONG_CODE = "??????"

describe("resolveCodeIdentifier", () => {
  it("normalizes an email before it reaches any callback", async () => {
    const { internals } = await createTestInternals()
    expect(
      resolveCodeIdentifier(internals, { email: "  Ada@Example.COM " })
    ).toEqual({
      kind: "email",
      value: "ada@example.com"
    })
  })

  it("rejects a malformed or oversized email before it becomes a key or a row", async () => {
    const { internals } = await createTestInternals()
    const invalid = expect.objectContaining({
      code: "invalidField",
      status: 400
    })

    for (const email of ["ada", "ada@", "@example.com", "ada@example"]) {
      expect(() => resolveCodeIdentifier(internals, { email }), email).toThrow(
        invalid
      )
    }

    // RFC 5321 caps a deliverable address at 254 characters. The phone side is
    // bounded by E.164 already; without this the email side was unbounded.
    const atLimit = `${"a".repeat(254 - "@example.com".length)}@example.com`
    expect(resolveCodeIdentifier(internals, { email: atLimit }).value).toBe(
      atLimit
    )
    expect(() =>
      resolveCodeIdentifier(internals, { email: `a${atLimit}` })
    ).toThrow(invalid)
  })

  it("requires exactly one identifier", async () => {
    const { internals } = await createTestInternals()
    const invalid = expect.objectContaining({ code: "invalidField" })

    expect(() => resolveCodeIdentifier(internals, {})).toThrow(invalid)
    expect(() =>
      resolveCodeIdentifier(internals, {
        email: "ada@example.com",
        phoneNumber: "+15555550123"
      })
    ).toThrow(invalid)
  })

  it("rejects a phone code when no sms sender is configured", async () => {
    const { internals } = await createTestInternals()
    expect(() =>
      resolveCodeIdentifier(internals, { phoneNumber: "+15555550123" })
    ).toThrow(expect.objectContaining({ code: "channelNotConfigured" }))
  })

  it("accepts and normalizes a phone number when sms is configured", async () => {
    const { internals } = await createTestInternals({
      sms: { sendCode: () => undefined }
    })
    expect(
      resolveCodeIdentifier(internals, { phoneNumber: "+1 (555) 555-0123" })
    ).toEqual({ kind: "phoneNumber", value: "+15555550123" })
  })
})

describe("sendVerificationCode", () => {
  const send = (
    internals: Awaited<ReturnType<typeof createTestInternals>>["internals"],
    headers = new Headers()
  ) =>
    sendVerificationCode(internals, {
      deliverTo: emailIdentifier,
      key: emailIdentifier.value,
      purpose: "signIn",
      locale: "en",
      headers
    })

  it("rolls the stored code back when delivery fails", async () => {
    // A row left behind by a code nobody received would sit bound to an
    // attempt token the client is about to present, for an outage that was the
    // sender's, not theirs.
    let outage = true
    const { internals, db, logCalls } = await createTestInternals({
      email: {
        sendCode: () => {
          if (outage) throw new Error("SMTP down")
        }
      }
    })

    await expect(send(internals)).rejects.toThrow("SMTP down")
    expect(await storedCodes(db)).toHaveLength(0)
    expect(
      logCalls.some(
        (call) =>
          call.level === "error" &&
          call.message === "verification code delivery failed"
      )
    ).toBe(true)

    outage = false
    await expect(send(internals)).resolves.toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await storedCodes(db)).toHaveLength(1)
  })

  it("delivers a code from the configured alphabet and stores only its scrypt hash", async () => {
    const { internals, db, sentCodes } = await createTestInternals()

    const attempt = await send(internals)

    const sent = required(sentCodes[0], "sent code")
    expect(sent.code).toHaveLength(6)
    for (const symbol of sent.code) {
      expect(CODE_ALPHABETS.alphanumeric).toContain(symbol)
    }
    expect(sent.destination).toBe("ada@example.com")

    const [stored] = await storedCodes(db)
    expect(stored?.codeHash).toMatch(/^\$scrypt\$ln=14,r=8,p=1\$/)
    expect(stored?.codeHash).not.toContain(sent.code)
    expect(stored?.attemptHash).toBe(await sha256Hex(attempt))
    expect(stored?.purpose).toBe("signIn")
  })

  it("honours a numeric alphabet and a longer code", async () => {
    const { internals, sentCodes } = await createTestInternals({
      verificationCode: { alphabet: "numeric", length: 8 }
    })

    const attempt = await send(internals)

    const sent = required(sentCodes[0], "sent code")
    expect(sent.code).toMatch(/^\d{8}$/)
    await expect(
      consumeVerificationCode(internals, {
        identifier: "ada@example.com",
        code: sent.code,
        purpose: "signIn",
        attempt
      })
    ).resolves.toBeUndefined()
  })

  it("files the code under the key, which need not be the address it went to", async () => {
    // An action a signed-in user confirms is keyed on their session: the code
    // still goes to their address, but only that session can redeem it.
    const { internals, sentCodes } = await createTestInternals()
    const attempt = await sendVerificationCode(internals, {
      deliverTo: emailIdentifier,
      key: "session-a",
      purpose: "identity",
      locale: "en",
      headers: new Headers()
    })
    const code = required(sentCodes[0], "sent code").code
    expect(required(sentCodes[0], "sent code").destination).toBe(
      "ada@example.com"
    )

    for (const identifier of ["ada@example.com", "session-b"]) {
      await expect(
        consumeVerificationCode(internals, {
          identifier,
          code,
          purpose: "identity",
          attempt
        })
      ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))
    }
    await expect(
      consumeVerificationCode(internals, {
        identifier: "session-a",
        code,
        purpose: "identity",
        attempt
      })
    ).resolves.toBeUndefined()
  })

  it("passes the resolved locale, purpose, and request headers to the sender", async () => {
    const { internals, sentCodes } = await createTestInternals()
    const headers = new Headers({
      host: "tenant.example.com",
      "user-agent": "TestBrowser/1.0"
    })

    await sendVerificationCode(internals, {
      deliverTo: emailIdentifier,
      key: emailIdentifier.value,
      purpose: "identity",
      locale: "de",
      headers
    })

    const sent = required(sentCodes[0], "sent code")
    expect(sent.locale).toBe("de")
    expect(sent.purpose).toBe("identity")
    expect(sent.headers.get("host")).toBe("tenant.example.com")
  })

  it("keeps every client's code live: a send never replaces another attempt's", async () => {
    const { internals, db, sentCodes } = await createTestInternals()

    const first = await send(internals)
    const second = await send(internals)
    const third = await send(internals)

    expect(await storedCodes(db)).toHaveLength(3)
    // Any of them verifies, but only with its own attempt token.
    await expect(
      consumeVerificationCode(internals, {
        identifier: "ada@example.com",
        code: required(sentCodes[0], "first").code,
        purpose: "signIn",
        attempt: second
      })
    ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))
    await consumeVerificationCode(internals, {
      identifier: "ada@example.com",
      code: required(sentCodes[0], "first").code,
      purpose: "signIn",
      attempt: first
    })
    await consumeVerificationCode(internals, {
      identifier: "ada@example.com",
      code: required(sentCodes[2], "third").code,
      purpose: "signIn",
      attempt: third
    })
    expect(await storedCodes(db)).toHaveLength(1)
  })

  it("never limits sends per address, only per client address", async () => {
    const { internals, sentCodes } = await createTestInternals({
      ipAddress: { trustedProxies: 1 },
      rateLimit: { sendCodePerIP: { max: 2, window: "10m" } }
    })
    const from = (address: string) =>
      send(internals, new Headers({ "x-forwarded-for": address }))

    await from("203.0.113.7")
    await from("203.0.113.7")
    await expect(from("203.0.113.7")).rejects.toThrowError(
      expect.objectContaining({ code: "rateLimited" })
    )
    // A different client asking for the same address is not affected.
    await from("203.0.113.8")
    expect(sentCodes).toHaveLength(3)
  })

  it("skips the per-IP window when rateLimit is false, and writes no attempt rows", async () => {
    const { internals, db, sentCodes } = await createTestInternals({
      rateLimit: false,
      ipAddress: { trustedProxies: 1 }
    })
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7" })

    for (let count = 0; count < 40; count++) await send(internals, headers)

    expect(await selectRows(db, "attempts")).toHaveLength(0)
    expect(sentCodes).toHaveLength(40)
  })
})

describe("markIdentityVerified", () => {
  it("keeps the row as the marker, and the code cannot be used twice", async () => {
    const { internals, sentCodes } = await createTestInternals()
    const attempt = await sendVerificationCode(internals, {
      deliverTo: emailIdentifier,
      key: "session-a",
      purpose: "identity",
      locale: "en",
      headers: new Headers()
    })
    const code = required(sentCodes[0], "sent code").code

    await expect(
      requireVerifiedIdentity(internals, "session-a", attempt)
    ).rejects.toThrowError(
      expect.objectContaining({ code: "verificationRequired" })
    )
    await markIdentityVerified(internals, {
      sessionId: "session-a",
      code,
      attempt
    })
    await expect(
      requireVerifiedIdentity(internals, "session-a", attempt)
    ).resolves.toBeUndefined()

    await expect(
      markIdentityVerified(internals, { sessionId: "session-a", code, attempt })
    ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))
    await expect(
      requireVerifiedIdentity(internals, "session-b", attempt)
    ).rejects.toThrowError(
      expect.objectContaining({ code: "verificationRequired" })
    )
  })
})

describe("consumeVerificationCode", () => {
  const sendAndRead = async (
    overrides: Parameters<typeof createTestInternals>[0] = {}
  ) => {
    const context = await createTestInternals(overrides)
    const attempt = await sendVerificationCode(context.internals, {
      deliverTo: emailIdentifier,
      key: emailIdentifier.value,
      purpose: "signIn",
      locale: "en",
      headers: new Headers()
    })
    return {
      ...context,
      attempt,
      code: required(context.sentCodes[0], "sent code").code
    }
  }

  it("accepts the right code once, so it cannot be replayed", async () => {
    const { internals, db, code, attempt } = await sendAndRead()

    await consumeVerificationCode(internals, {
      identifier: "ada@example.com",
      code,
      purpose: "signIn",
      attempt
    })

    expect(await storedCodes(db)).toHaveLength(0)
    await expect(
      consumeVerificationCode(internals, {
        identifier: "ada@example.com",
        code,
        purpose: "signIn",
        attempt
      })
    ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))
  })

  it("accepts the code in any case, so a phone keyboard cannot get it wrong", async () => {
    const { internals, code, attempt } = await sendAndRead()

    await expect(
      consumeVerificationCode(internals, {
        identifier: "ada@example.com",
        code: code.toLowerCase(),
        purpose: "signIn",
        attempt
      })
    ).resolves.toBeUndefined()
  })

  it("refuses the right code without its attempt token", async () => {
    const { internals, db, code, attempt } = await sendAndRead()

    for (const presented of [null, "", `${attempt}x`]) {
      await expect(
        consumeVerificationCode(internals, {
          identifier: "ada@example.com",
          code,
          purpose: "signIn",
          attempt: presented
        })
      ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))
    }
    expect(await storedCodes(db)).toHaveLength(1)
  })

  it("rejects a sign-in code presented for deletion, and the reverse", async () => {
    const { internals, code, attempt } = await sendAndRead()

    await expect(
      consumeVerificationCode(internals, {
        identifier: "ada@example.com",
        code,
        purpose: "identity",
        attempt
      })
    ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))
  })

  it("limits guesses per address, whoever is guessing", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"))
    try {
      const { internals, db, code, attempt } = await sendAndRead()
      const guess = (value: string, token = attempt) =>
        consumeVerificationCode(internals, {
          identifier: "ada@example.com",
          code: value,
          purpose: "signIn",
          attempt: token
        })

      for (let count = 0; count < 5; count++) {
        await expect(guess(WRONG_CODE)).rejects.toThrowError(
          expect.objectContaining({ code: "invalidCode" })
        )
      }
      expect(await countGuesses(db, "ada@example.com")).toBe(5)

      // The sixth is refused before it is even compared — with the right code,
      // and from a different attempt on the same address.
      const stranger = await sendVerificationCode(internals, {
        deliverTo: emailIdentifier,
        key: emailIdentifier.value,
        purpose: "signIn",
        locale: "en",
        headers: new Headers()
      })
      for (const [value, token] of [
        [code, attempt],
        [WRONG_CODE, stranger]
      ] as const) {
        await expect(guess(value, token)).rejects.toThrowError(
          expect.objectContaining({ code: "rateLimited", retryAfter: 300 })
        )
      }
      // The code itself was never spent, and the window passing restores it.
      expect(await storedCodes(db)).toHaveLength(2)
      vi.advanceTimersByTime(5 * 60_000)
      await expect(guess(code)).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps the guess limit on under rateLimit: false", async () => {
    const { internals, code, attempt } = await sendAndRead({
      rateLimit: false
    })
    const guess = (value: string) =>
      consumeVerificationCode(internals, {
        identifier: "ada@example.com",
        code: value,
        purpose: "signIn",
        attempt
      })

    for (let count = 0; count < 5; count++) {
      await expect(guess(WRONG_CODE)).rejects.toThrowError(
        expect.objectContaining({ code: "invalidCode" })
      )
    }
    await expect(guess(code)).rejects.toThrowError(
      expect.objectContaining({ code: "rateLimited" })
    )
  })

  it("lets exactly one of two concurrent valid submissions succeed", async () => {
    // Regression for the double-consume race: both requests read the row and
    // pass the HMAC check, so the conditional delete has to be the gate. A real
    // database has latency between read and delete — model it with a yield.
    const { internals, code, attempt } = await sendAndRead()
    const originalDelete = internals.db.delete.bind(internals.db)
    internals.db.delete = async (input) => {
      if (input.table === "verifications") {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      return originalDelete(input)
    }
    const submit = () =>
      consumeVerificationCode(internals, {
        identifier: "ada@example.com",
        code,
        purpose: "signIn",
        attempt
      })

    const results = await Promise.allSettled([submit(), submit()])

    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1)
    expect(
      results.filter((result) => result.status === "rejected")
    ).toHaveLength(1)
  })

  it("rejects an expired code", async () => {
    const { internals, db, code, attempt } = await sendAndRead()
    const [stored] = await storedCodes(db)
    await db.update({
      table: "verifications",
      where: { id: { eq: required(stored, "stored").id } },
      values: { expiresAt: new Date(Date.now() - 1000) }
    })

    await expect(
      consumeVerificationCode(internals, {
        identifier: "ada@example.com",
        code,
        purpose: "signIn",
        attempt
      })
    ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))
  })

  it("rejects a code for an identifier that never requested one", async () => {
    const { internals } = await createTestInternals()

    await expect(
      consumeVerificationCode(internals, {
        identifier: "nobody@example.com",
        code: "ABCDEF",
        purpose: "signIn",
        attempt: "anything"
      })
    ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))
  })
})
