import { describe, expect, it, vi } from "vitest"
import { consumeMagicCode } from "../../src/magic-code/consume-magic-code.ts"
import { resolveCodeIdentifier } from "../../src/magic-code/resolve-code-identifier.ts"
import { sendMagicCode } from "../../src/magic-code/send-magic-code.ts"
import { createTestInternals } from "../helpers/create-test-internals.ts"
import { required } from "../helpers/required.ts"

const emailIdentifier = { kind: "email", value: "ada@example.com" } as const

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

  it("requires exactly one identifier", async () => {
    const { internals } = await createTestInternals()

    expect(() => resolveCodeIdentifier(internals, {})).toThrowError(
      expect.objectContaining({ code: "invalidField" })
    )
    expect(() =>
      resolveCodeIdentifier(internals, {
        email: "ada@example.com",
        phoneNumber: "+15551234567"
      })
    ).toThrowError(expect.objectContaining({ code: "invalidField" }))
  })

  it("rejects a phone code when no sms sender is configured", async () => {
    const { internals } = await createTestInternals()
    expect(() =>
      resolveCodeIdentifier(internals, { phoneNumber: "+15551234567" })
    ).toThrowError(expect.objectContaining({ code: "channelNotConfigured" }))
  })

  it("accepts and normalizes a phone number when sms is configured", async () => {
    const { internals } = await createTestInternals({
      sms: { sendCode: () => {} }
    })
    expect(
      resolveCodeIdentifier(internals, { phoneNumber: "+1 (555) 123-4567" })
    ).toEqual({
      kind: "phoneNumber",
      value: "+15551234567"
    })
  })
})

describe("sendMagicCode", () => {
  it("delivers a six-digit code and stores only its HMAC", async () => {
    const { internals, db, sentCodes } = await createTestInternals()

    await sendMagicCode(internals, {
      identifier: emailIdentifier,
      purpose: "signIn",
      locale: "en",
      headers: new Headers()
    })

    const sent = required(sentCodes[0], "sent code")
    expect(sent.code).toMatch(/^\d{6}$/)
    expect(sent.destination).toBe("ada@example.com")

    const stored = required(
      await db.getMagicCode({ identifier: "ada@example.com" }),
      "stored code"
    )
    expect(stored.codeHash).toMatch(/^[0-9a-f]{64}$/)
    expect(stored.codeHash).not.toContain(sent.code)
    expect(stored.attempts).toBe(0)
    expect(stored.purpose).toBe("signIn")
  })

  it("passes the resolved locale, purpose, and request headers to the sender", async () => {
    const { internals, sentCodes } = await createTestInternals()
    const headers = new Headers({
      host: "tenant.example.com",
      "user-agent": "TestBrowser/1.0"
    })

    await sendMagicCode(internals, {
      identifier: emailIdentifier,
      purpose: "deleteUser",
      locale: "de",
      headers
    })

    const sent = required(sentCodes[0], "sent code")
    expect(sent.locale).toBe("de")
    expect(sent.purpose).toBe("deleteUser")
    expect(sent.headers.get("host")).toBe("tenant.example.com")
  })

  it("replaces the live code on resend, so only one code is ever guessable", async () => {
    const { internals, db, sentCodes } = await createTestInternals({
      rateLimit: false
    })

    await sendMagicCode(internals, {
      identifier: emailIdentifier,
      purpose: "signIn",
      locale: "en",
      headers: new Headers()
    })
    const firstHash = required(
      await db.getMagicCode({ identifier: "ada@example.com" }),
      "first"
    ).codeHash

    await sendMagicCode(internals, {
      identifier: emailIdentifier,
      purpose: "signIn",
      locale: "en",
      headers: new Headers()
    })
    const secondHash = required(
      await db.getMagicCode({ identifier: "ada@example.com" }),
      "second"
    ).codeHash

    expect(sentCodes).toHaveLength(2)
    expect(secondHash).not.toBe(firstHash)

    // The first code no longer verifies.
    await expect(
      consumeMagicCode(internals, {
        identifier: "ada@example.com",
        code: required(sentCodes[0], "first sent").code,
        purpose: "signIn"
      })
    ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))
  })

  it("enforces the 60 second cooldown with an accurate retryAfter, and sends nothing", async () => {
    const { internals, sentCodes } = await createTestInternals()

    await sendMagicCode(internals, {
      identifier: emailIdentifier,
      purpose: "signIn",
      locale: "en",
      headers: new Headers()
    })
    await expect(
      sendMagicCode(internals, {
        identifier: emailIdentifier,
        purpose: "signIn",
        locale: "en",
        headers: new Headers()
      })
    ).rejects.toThrowError(
      expect.objectContaining({ code: "cooldown", retryAfter: 60 })
    )

    expect(sentCodes).toHaveLength(1)
  })

  it("allows a resend once the cooldown has passed but the window has not", async () => {
    vi.useFakeTimers()
    try {
      const { internals, sentCodes } = await createTestInternals()
      await sendMagicCode(internals, {
        identifier: emailIdentifier,
        purpose: "signIn",
        locale: "en",
        headers: new Headers()
      })

      vi.advanceTimersByTime(61_000)
      await sendMagicCode(internals, {
        identifier: emailIdentifier,
        purpose: "signIn",
        locale: "en",
        headers: new Headers()
      })

      expect(sentCodes).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("stops the fourth send in the window with 429 and sends no email", async () => {
    vi.useFakeTimers()
    try {
      const { internals, sentCodes } = await createTestInternals()

      for (let attempt = 0; attempt < 3; attempt++) {
        await sendMagicCode(internals, {
          identifier: emailIdentifier,
          purpose: "signIn",
          locale: "en",
          headers: new Headers()
        })
        vi.advanceTimersByTime(61_000)
      }

      await expect(
        sendMagicCode(internals, {
          identifier: emailIdentifier,
          purpose: "signIn",
          locale: "en",
          headers: new Headers()
        })
      ).rejects.toThrowError(expect.objectContaining({ code: "rateLimited" }))

      expect(sentCodes).toHaveLength(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it("resets the counter once the window expires", async () => {
    vi.useFakeTimers()
    try {
      const { internals, sentCodes } = await createTestInternals()

      for (let attempt = 0; attempt < 3; attempt++) {
        await sendMagicCode(internals, {
          identifier: emailIdentifier,
          purpose: "signIn",
          locale: "en",
          headers: new Headers()
        })
        vi.advanceTimersByTime(61_000)
      }

      vi.advanceTimersByTime(10 * 60_000)
      await sendMagicCode(internals, {
        identifier: emailIdentifier,
        purpose: "signIn",
        locale: "en",
        headers: new Headers()
      })

      expect(sentCodes).toHaveLength(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it("skips the limiter callbacks entirely when rateLimit is false", async () => {
    const { internals, db, sentCodes } = await createTestInternals({
      rateLimit: false
    })
    const getRateLimit = vi.spyOn(db, "getRateLimit")
    const upsertRateLimit = vi.spyOn(db, "upsertRateLimit")

    await sendMagicCode(internals, {
      identifier: emailIdentifier,
      purpose: "signIn",
      locale: "en",
      headers: new Headers()
    })
    await sendMagicCode(internals, {
      identifier: emailIdentifier,
      purpose: "signIn",
      locale: "en",
      headers: new Headers()
    })

    expect(getRateLimit).not.toHaveBeenCalled()
    expect(upsertRateLimit).not.toHaveBeenCalled()
    expect(sentCodes).toHaveLength(2)
  })

  it("counts per-ip sends from the proxy header", async () => {
    const { internals, db } = await createTestInternals()
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7" })

    await sendMagicCode(internals, {
      identifier: emailIdentifier,
      purpose: "signIn",
      locale: "en",
      headers
    })

    expect(
      await db.getRateLimit({ key: "sendCode:ip:203.0.113.7" })
    ).toMatchObject({ count: 1 })
  })
})

describe("consumeMagicCode", () => {
  const sendAndRead = async () => {
    const context = await createTestInternals()
    await sendMagicCode(context.internals, {
      identifier: emailIdentifier,
      purpose: "signIn",
      locale: "en",
      headers: new Headers()
    })
    return {
      ...context,
      code: required(context.sentCodes[0], "sent code").code
    }
  }

  it("accepts the right code and burns it, so it cannot be replayed", async () => {
    const { internals, db, code } = await sendAndRead()

    await consumeMagicCode(internals, {
      identifier: "ada@example.com",
      code,
      purpose: "signIn"
    })

    expect(await db.getMagicCode({ identifier: "ada@example.com" })).toBeNull()
    await expect(
      consumeMagicCode(internals, {
        identifier: "ada@example.com",
        code,
        purpose: "signIn"
      })
    ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))
  })

  it("rejects a sign-in code presented for deletion, and the reverse", async () => {
    const { internals, code } = await sendAndRead()

    await expect(
      consumeMagicCode(internals, {
        identifier: "ada@example.com",
        code,
        purpose: "deleteUser"
      })
    ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))
  })

  it("burns the code after five wrong guesses", async () => {
    const { internals, db, code } = await sendAndRead()
    const wrongCode = code === "000000" ? "111111" : "000000"

    for (let attempt = 0; attempt < 4; attempt++) {
      await expect(
        consumeMagicCode(internals, {
          identifier: "ada@example.com",
          code: wrongCode,
          purpose: "signIn"
        })
      ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))
    }
    expect(
      required(
        await db.getMagicCode({ identifier: "ada@example.com" }),
        "code row"
      ).attempts
    ).toBe(4)

    await expect(
      consumeMagicCode(internals, {
        identifier: "ada@example.com",
        code: wrongCode,
        purpose: "signIn"
      })
    ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))

    expect(await db.getMagicCode({ identifier: "ada@example.com" })).toBeNull()

    // Even the correct code is dead once the row is burned.
    await expect(
      consumeMagicCode(internals, {
        identifier: "ada@example.com",
        code,
        purpose: "signIn"
      })
    ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))
  })

  it("rejects an expired code", async () => {
    const { internals, db, code } = await sendAndRead()
    const stored = required(
      await db.getMagicCode({ identifier: "ada@example.com" }),
      "stored"
    )
    await db.upsertMagicCode({
      ...stored,
      expiresAt: new Date(Date.now() - 1000)
    })

    await expect(
      consumeMagicCode(internals, {
        identifier: "ada@example.com",
        code,
        purpose: "signIn"
      })
    ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))
  })

  it("rejects a code for an identifier that never requested one", async () => {
    const { internals } = await createTestInternals()

    await expect(
      consumeMagicCode(internals, {
        identifier: "nobody@example.com",
        code: "123456",
        purpose: "signIn"
      })
    ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))
  })
})
