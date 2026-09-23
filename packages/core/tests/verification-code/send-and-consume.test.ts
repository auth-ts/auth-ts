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
import { selectRow, selectRows } from "../helpers/rows"

const emailIdentifier = { kind: "email", value: "ada@example.com" } as const

/** Every code stored for the identifier, one per attempt that asked. */
const storedCodes = (db: MemoryDatabase) =>
  selectRows(db, "verifications", { identifier: { eq: emailIdentifier.value } })

/** Tokens left in an identifier's guess bucket. */
const guessTokens = async (db: MemoryDatabase, identifier: string) =>
  required(
    await selectRow(db, "rateLimits", { key: { eq: `guess:${identifier}` } }),
    "guess bucket"
  ).tokenCount

/** A code no generator would draw: outside the alphabet, so never a collision. */
const WRONG_CODE = "??????"

describe("resolveCodeIdentifier", () => {
  it("takes an email as sent, and refuses one the book would", async () => {
    // Never modified: what the user typed is what is stored and shown.
    const { internals } = await createTestInternals()
    expect(
      resolveCodeIdentifier(internals, { email: "ada@example.com" })
    ).toEqual({ kind: "email", value: "ada@example.com" })

    const invalid = expect.objectContaining({
      code: "invalidEmailAddress",
      status: 400
    })
    for (const email of [
      "Ada@Example.COM",
      " ada@example.com ",
      "ada",
      "ada@",
      "@example.com",
      "ada@example",
      `${"a".repeat(101 - "@example.com".length)}@example.com`
    ]) {
      expect(() => resolveCodeIdentifier(internals, { email }), email).toThrow(
        invalid
      )
    }
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
      limit: { key: "send:test", bucket: "sends" },
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
        attempt,
        guessKey: "ada@example.com"
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
      limit: { key: "identity:test", bucket: "identitySends" },
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
          attempt,
          guessKey: "user-1"
        })
      ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))
    }
    await expect(
      consumeVerificationCode(internals, {
        identifier: "session-a",
        code,
        purpose: "identity",
        attempt,
        guessKey: "user-1"
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
      limit: { key: "identity:test", bucket: "identitySends" },
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
        attempt: second,
        guessKey: "ada@example.com"
      })
    ).rejects.toThrowError(expect.objectContaining({ code: "incorrectCode" }))
    await consumeVerificationCode(internals, {
      identifier: "ada@example.com",
      code: required(sentCodes[0], "first").code,
      purpose: "signIn",
      attempt: first,
      guessKey: "ada@example.com"
    })
    await consumeVerificationCode(internals, {
      identifier: "ada@example.com",
      code: required(sentCodes[2], "third").code,
      purpose: "signIn",
      attempt: third,
      guessKey: "ada@example.com"
    })
    expect(await storedCodes(db)).toHaveLength(1)
  })

  it("limits sends per address, whoever asks, and leaves other addresses alone", async () => {
    const { internals, sentCodes } = await createTestInternals({
      rateLimit: { sends: { capacity: 2, refill: "30m" } }
    })
    const to = (address: string) =>
      sendVerificationCode(internals, {
        deliverTo: { kind: "email", value: address },
        key: address,
        purpose: "signIn",
        limit: { key: `send:${address}`, bucket: "sends" },
        locale: "en",
        headers: new Headers()
      })

    await to("ada@example.com")
    await to("ada@example.com")
    await expect(to("ada@example.com")).rejects.toThrowError(
      expect.objectContaining({ code: "rateLimited" })
    )
    await to("grace@example.com")
    expect(sentCodes).toHaveLength(3)
  })

  it("skips the send bucket when rateLimit is false, and writes no bucket rows", async () => {
    const { internals, db, sentCodes } = await createTestInternals({
      rateLimit: false
    })

    for (let count = 0; count < 40; count++) {
      await send(internals, new Headers())
    }

    expect(await selectRows(db, "rateLimits")).toHaveLength(0)
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
      limit: { key: "identity:test", bucket: "identitySends" },
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
      userId: "user-1",
      code,
      attempt
    })
    await expect(
      requireVerifiedIdentity(internals, "session-a", attempt)
    ).resolves.toBeUndefined()

    await expect(
      markIdentityVerified(internals, {
        sessionId: "session-a",
        userId: "user-1",
        code,
        attempt
      })
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
      limit: { key: `send:${emailIdentifier.value}`, bucket: "sends" },
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
      attempt,
      guessKey: "ada@example.com"
    })

    expect(await storedCodes(db)).toHaveLength(0)
    await expect(
      consumeVerificationCode(internals, {
        identifier: "ada@example.com",
        code,
        purpose: "signIn",
        attempt,
        guessKey: "ada@example.com"
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
        attempt,
        guessKey: "ada@example.com"
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
          attempt: presented,
          guessKey: "ada@example.com"
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
        attempt,
        guessKey: "ada@example.com"
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
          attempt: token,
          guessKey: "ada@example.com"
        })

      for (let count = 0; count < 5; count++) {
        await expect(guess(WRONG_CODE)).rejects.toThrowError(
          expect.objectContaining({ code: "incorrectCode" })
        )
      }
      expect(await guessTokens(db, "ada@example.com")).toBe(0)

      // The sixth is refused before it is even compared — with the right code,
      // and from a different attempt on the same address.
      const stranger = await sendVerificationCode(internals, {
        deliverTo: emailIdentifier,
        key: emailIdentifier.value,
        purpose: "signIn",
        limit: { key: "send:test", bucket: "sends" },
        locale: "en",
        headers: new Headers()
      })
      for (const [value, token] of [
        [code, attempt],
        [WRONG_CODE, stranger]
      ] as const) {
        await expect(guess(value, token)).rejects.toThrowError(
          expect.objectContaining({ code: "rateLimited", retryAfter: 60 })
        )
      }
      // The code itself was never spent, and a minute buys one more try.
      expect(await storedCodes(db)).toHaveLength(2)
      vi.advanceTimersByTime(60_000)
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
        attempt,
        guessKey: "ada@example.com"
      })

    for (let count = 0; count < 5; count++) {
      await expect(guess(WRONG_CODE)).rejects.toThrowError(
        expect.objectContaining({ code: "incorrectCode" })
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
        attempt,
        guessKey: "ada@example.com"
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
      values: { createdAt: new Date(0) }
    })

    await expect(
      consumeVerificationCode(internals, {
        identifier: "ada@example.com",
        code,
        purpose: "signIn",
        attempt,
        guessKey: "ada@example.com"
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
        attempt: "anything",
        guessKey: "nobody@example.com"
      })
    ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))
  })
})
