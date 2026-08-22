import { describe, expect, it, vi } from "vitest"
import { hmacSha256Hex } from "../../src/lib/hash.ts"
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
  it("rolls the stored code back when delivery fails, so the retry is not in cooldown", async () => {
    // The cooldown is derived from the live row. A row left behind by a code
    // nobody received would refuse the user's retry for a minute — for an
    // outage that was the sender's, not theirs.
    let outage = true
    const { internals, db, logCalls } = await createTestInternals({
      email: {
        sendCode: () => {
          if (outage) throw new Error("SMTP down")
        }
      }
    })
    const send = () =>
      sendMagicCode(internals, {
        identifier: emailIdentifier,
        purpose: "signIn",
        locale: "en",
        headers: new Headers()
      })

    await expect(send()).rejects.toThrow("SMTP down")
    expect(await db.getMagicCode({ identifier: "ada@example.com" })).toBeNull()
    expect(
      logCalls.some(
        (call) =>
          call.level === "error" &&
          call.message === "magic code delivery failed"
      )
    ).toBe(true)

    outage = false
    await expect(send()).resolves.toBeUndefined()
    expect(
      await db.getMagicCode({ identifier: "ada@example.com" })
    ).not.toBeNull()
  })

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
    const { internals, db } = await createTestInternals({
      clientIp: { trustedProxies: 1 }
    })
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
    // The counter is the rate-limit row keyed on the code's hash, not a field
    // on the code row — that is what makes it atomic.
    const key = `magicCode:attempts:${await hmacSha256Hex(code, internals.config.secret)}`
    expect((await db.getRateLimit({ key }))?.count).toBe(4)
    expect(
      await db.getMagicCode({ identifier: "ada@example.com" })
    ).not.toBeNull()

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

  it("lets exactly one of two concurrent valid submissions succeed", async () => {
    // Regression for the double-consume race: both requests read the row and
    // pass the HMAC check, so the conditional delete has to be the gate. A real
    // database has latency between read and delete — model it with a yield.
    const { internals, db, code } = await sendAndRead()
    const originalDelete = db.deleteMagicCode.bind(db)
    db.deleteMagicCode = async (where) => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return originalDelete(where)
    }

    const results = await Promise.allSettled([
      consumeMagicCode(internals, {
        identifier: "ada@example.com",
        code,
        purpose: "signIn"
      }),
      consumeMagicCode(internals, {
        identifier: "ada@example.com",
        code,
        purpose: "signIn"
      })
    ])

    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1)
    expect(
      results.filter((result) => result.status === "rejected")
    ).toHaveLength(1)
  })

  it("refuses a code issued before a resend, even if its row was read before the resend landed", async () => {
    // The hash is part of the delete's where clause, so the old code cannot
    // consume the row the resend created. Limits off so the resend is not
    // stopped by the cooldown before it ever reaches the store.
    const { internals, db, sentCodes } = await createTestInternals({
      rateLimit: false
    })
    await sendMagicCode(internals, {
      identifier: emailIdentifier,
      purpose: "signIn",
      locale: "en",
      headers: new Headers()
    })
    const oldCode = required(sentCodes[0], "first code").code
    await sendMagicCode(internals, {
      identifier: emailIdentifier,
      purpose: "signIn",
      locale: "en",
      headers: new Headers()
    })
    const newCode = required(sentCodes.at(-1), "resent code").code
    expect(newCode).not.toBe(oldCode)

    await expect(
      consumeMagicCode(internals, {
        identifier: "ada@example.com",
        code: oldCode,
        purpose: "signIn"
      })
    ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))
    expect(
      await db.getMagicCode({ identifier: "ada@example.com" })
    ).not.toBeNull()

    await consumeMagicCode(internals, {
      identifier: "ada@example.com",
      code: newCode,
      purpose: "signIn"
    })
  })

  it("does not burn a resend's fresh code when a stale request hits the attempt cap", async () => {
    // Four wrong guesses against code A. The fifth reads A; before it acts, a
    // resend replaces the row with B. The fifth decides to burn — but it read A,
    // so it must burn A and only A. B has no attempts against it and survives.
    // The resend is injected into the read itself, the narrowest interleaving
    // there is: no sleep, no luck. Limits off so the resend is not stopped by
    // the cooldown before it reaches the store.
    const { internals, db, sentCodes } = await createTestInternals({
      rateLimit: false
    })
    const send = () =>
      sendMagicCode(internals, {
        identifier: emailIdentifier,
        purpose: "signIn",
        locale: "en",
        headers: new Headers()
      })
    await send()
    const codeA = required(sentCodes[0], "first code").code
    const wrongCode = codeA === "000000" ? "111111" : "000000"
    const guessWrong = () =>
      expect(
        consumeMagicCode(internals, {
          identifier: "ada@example.com",
          code: wrongCode,
          purpose: "signIn"
        })
      ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))

    for (let attempt = 0; attempt < 4; attempt++) await guessWrong()

    const realGet = db.getMagicCode.bind(db)
    const readThenResend = vi
      .spyOn(db, "getMagicCode")
      .mockImplementationOnce(async (where) => {
        const row = await realGet(where)
        await send()
        return row
      })
    await guessWrong()
    readThenResend.mockRestore()

    const codeB = required(sentCodes.at(-1), "resent code").code
    expect(codeB).not.toBe(codeA)
    // B is still there: the burn matched A's hash and found nothing. And the
    // stale guesses counted against A's key alone — B starts with a full budget,
    // so a wrong guess against it is its first, not its sixth.
    const keyFor = async (c: string) =>
      `magicCode:attempts:${await hmacSha256Hex(c, internals.config.secret)}`
    expect((await db.getRateLimit({ key: await keyFor(codeA) }))?.count).toBe(5)
    expect(await db.getRateLimit({ key: await keyFor(codeB) })).toBeNull()
    await guessWrong()
    expect(
      await db.getMagicCode({ identifier: "ada@example.com" })
    ).not.toBeNull()
    await consumeMagicCode(internals, {
      identifier: "ada@example.com",
      code: codeB,
      purpose: "signIn"
    })
  })

  it("counts concurrent wrong guesses atomically, so the cap cannot be raced past", async () => {
    // Fifty wrong guesses in flight at once, every one reading the row before
    // any has counted. A counter on the code row let them all write back 0 + 1
    // and the code survived with one attempt against it; through
    // upsertRateLimit they count as fifty and the code is burned. The read is
    // made to cross an event-loop turn so the guesses genuinely overlap. Default
    // options, which is the configuration with no per-IP limit behind the cap.
    const { internals, db, sentCodes } = await createTestInternals()
    await sendMagicCode(internals, {
      identifier: emailIdentifier,
      purpose: "signIn",
      locale: "en",
      headers: new Headers()
    })
    const code = required(sentCodes[0], "code").code
    const wrongCode = code === "000000" ? "111111" : "000000"
    const realGet = db.getMagicCode.bind(db)
    vi.spyOn(db, "getMagicCode").mockImplementation(async (where) => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      return realGet(where)
    })

    const results = await Promise.allSettled(
      Array.from({ length: 50 }, () =>
        consumeMagicCode(internals, {
          identifier: "ada@example.com",
          code: wrongCode,
          purpose: "signIn"
        })
      )
    )

    expect(results.every((result) => result.status === "rejected")).toBe(true)
    expect(await realGet({ identifier: "ada@example.com" })).toBeNull()
    // And the right code is dead with it.
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
