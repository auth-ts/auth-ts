import { describe, expect, it, vi } from "vitest"
import { hmacSha256Hex } from "../../src/lib/hash"
import type { MemoryDb } from "../../src/lib/memory-db"
import { consumeVerificationCode } from "../../src/verification-code/consume-verification-code"
import { resolveCodeIdentifier } from "../../src/verification-code/resolve-code-identifier"
import { sendVerificationCode } from "../../src/verification-code/send-verification-code"
import { createTestInternals } from "../helpers/create-test-internals"
import { required } from "../helpers/required"
import { selectRows } from "../helpers/rows"

const emailIdentifier = { kind: "email", value: "ada@example.com" } as const

/** Every code stored for the identifier. A send replaces them, so normally one. */
const storedCodes = (db: MemoryDb) =>
  selectRows(db, "verificationCodes", { identifier: emailIdentifier.value })

/** The row a verify would read: the newest by expiry, exactly as core reads it. */
const liveCode = async (db: MemoryDb) => {
  const [row] = await db.select({
    table: "verificationCodes",
    where: { identifier: emailIdentifier.value },
    limit: 1,
    offset: 0,
    orderBy: { expiresAt: "desc" }
  })

  return row ?? null
}

/**
 * How many attempts are on record for a key.
 *
 * The limiter appends a row per counted request rather than incrementing a
 * counter, so the count is a row count — and a window key carries the aligned
 * window start as a suffix, which is why this matches on a prefix.
 */
const countAttempts = async (db: MemoryDb, prefix: string) => {
  const rows = await selectRows(db, "attempts")

  return rows.filter((row) => row.key.startsWith(prefix)).length
}

/** The key a wrong guess against `code` is counted under. */
const attemptKey = async (secret: string, code: string) =>
  `verificationCode:attempts:${await hmacSha256Hex(code, secret)}`

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

describe("sendVerificationCode", () => {
  it("rolls the stored code back when delivery fails, so the retry is not in cooldown", async () => {
    // The cooldown is derived from the newest stored row. A row left behind by a
    // code nobody received would refuse the user's retry for a minute — for an
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
      sendVerificationCode(internals, {
        identifier: emailIdentifier,
        action: "signIn",
        locale: "en",
        headers: new Headers()
      })

    await expect(send()).rejects.toThrow("SMTP down")
    expect(await storedCodes(db)).toHaveLength(0)
    expect(
      logCalls.some(
        (call) =>
          call.level === "error" &&
          call.message === "verification code delivery failed"
      )
    ).toBe(true)

    outage = false
    await expect(send()).resolves.toBeUndefined()
    expect(await liveCode(db)).not.toBeNull()
  })

  it("leaves the identifier resendable at once when racing sends end with a failed delivery", async () => {
    // A stores code A, B stores code B over it, A delivers, B's delivery
    // fails. B's store deleted A's row and latest wins, so the code that
    // reached the inbox was already dead; B's rollback then matches on B's own
    // hash and takes back the code nobody received. Nothing usable was
    // delivered and nothing unusable is left behind, so the question is only
    // what the person can do about it: asking again works immediately rather
    // than after a cooldown for a code that never arrived.
    let deliveries = 0
    const { internals, db, sentCodes } = await createTestInternals({
      email: {
        sendCode: ({ email, code, locale, action, headers }) => {
          deliveries += 1
          if (deliveries === 2) throw new Error("SMTP blip")
          sentCodes.push({
            channel: "email",
            destination: email,
            code,
            locale,
            action,
            headers
          })
        }
      }
    })
    const send = () =>
      sendVerificationCode(internals, {
        identifier: emailIdentifier,
        action: "signIn",
        locale: "en",
        headers: new Headers()
      })

    const outcomes = await Promise.allSettled([send(), send()])
    // One of the two loses the race for the second delivery and is the
    // rejection — which one is the scheduler's business, not the contract's.
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual([
      "fulfilled",
      "rejected"
    ])
    const rejected = outcomes.find(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === "rejected"
    )
    expect(String(rejected?.reason)).toContain("SMTP blip")

    // The code that did arrive belonged to the superseded send.
    await expect(
      consumeVerificationCode(internals, {
        identifier: "ada@example.com",
        code: required(sentCodes[0], "delivered code").code,
        action: "signIn"
      })
    ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))
    expect(await storedCodes(db)).toHaveLength(0)

    // And the immediate retry is not in cooldown.
    await expect(send()).resolves.toBeUndefined()
    expect(await liveCode(db)).not.toBeNull()
  })

  it("delivers a six-digit code and stores only its HMAC", async () => {
    const { internals, db, sentCodes } = await createTestInternals()

    await sendVerificationCode(internals, {
      identifier: emailIdentifier,
      action: "signIn",
      locale: "en",
      headers: new Headers()
    })

    const sent = required(sentCodes[0], "sent code")
    expect(sent.code).toMatch(/^\d{6}$/)
    expect(sent.destination).toBe("ada@example.com")

    const stored = required(await liveCode(db), "stored code")
    expect(stored.codeHash).toMatch(/^[0-9a-f]{64}$/)
    expect(stored.codeHash).not.toContain(sent.code)
    expect(stored.action).toBe("signIn")
    // The guess budget is a set of attempt rows keyed on the hash rather than a
    // column on this row, so a fresh code simply has none against it.
    expect(
      await countAttempts(db, `verificationCode:attempts:${stored.codeHash}`)
    ).toBe(0)
  })

  it("passes the resolved locale, action, and request headers to the sender", async () => {
    const { internals, sentCodes } = await createTestInternals()
    const headers = new Headers({
      host: "tenant.example.com",
      "user-agent": "TestBrowser/1.0"
    })

    await sendVerificationCode(internals, {
      identifier: emailIdentifier,
      action: "deleteUser",
      locale: "de",
      headers
    })

    const sent = required(sentCodes[0], "sent code")
    expect(sent.locale).toBe("de")
    expect(sent.action).toBe("deleteUser")
    expect(sent.headers.get("host")).toBe("tenant.example.com")
  })

  it("replaces the code on resend, so only the latest one is guessable", async () => {
    const { internals, db, sentCodes } = await createTestInternals({
      rateLimit: false
    })

    await sendVerificationCode(internals, {
      identifier: emailIdentifier,
      action: "signIn",
      locale: "en",
      headers: new Headers()
    })
    const firstHash = required(await liveCode(db), "first").codeHash

    await sendVerificationCode(internals, {
      identifier: emailIdentifier,
      action: "signIn",
      locale: "en",
      headers: new Headers()
    })

    expect(sentCodes).toHaveLength(2)
    // A send deletes the identifier's codes and inserts one: the first code's
    // row is gone rather than merely outranked.
    const stored = await storedCodes(db)
    expect(stored).toHaveLength(1)
    expect(required(stored[0], "second").codeHash).not.toBe(firstHash)

    // The first code no longer verifies.
    await expect(
      consumeVerificationCode(internals, {
        identifier: "ada@example.com",
        code: required(sentCodes[0], "first sent").code,
        action: "signIn"
      })
    ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))
  })

  it("enforces the 60 second cooldown with an accurate retryAfter, and sends nothing", async () => {
    const { internals, sentCodes } = await createTestInternals()

    await sendVerificationCode(internals, {
      identifier: emailIdentifier,
      action: "signIn",
      locale: "en",
      headers: new Headers()
    })
    await expect(
      sendVerificationCode(internals, {
        identifier: emailIdentifier,
        action: "signIn",
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
    // Windows are aligned to the clock, so the test starts on a boundary and
    // every send below lands in a window the test names rather than one the
    // wall clock happened to be in.
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"))
    try {
      const { internals, sentCodes } = await createTestInternals()
      await sendVerificationCode(internals, {
        identifier: emailIdentifier,
        action: "signIn",
        locale: "en",
        headers: new Headers()
      })

      vi.advanceTimersByTime(61_000)
      await sendVerificationCode(internals, {
        identifier: emailIdentifier,
        action: "signIn",
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
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"))
    try {
      const { internals, db, sentCodes } = await createTestInternals()

      for (let attempt = 0; attempt < 3; attempt++) {
        await sendVerificationCode(internals, {
          identifier: emailIdentifier,
          action: "signIn",
          locale: "en",
          headers: new Headers()
        })
        vi.advanceTimersByTime(61_000)
      }

      await expect(
        sendVerificationCode(internals, {
          identifier: emailIdentifier,
          action: "signIn",
          locale: "en",
          headers: new Headers()
        })
      ).rejects.toThrowError(expect.objectContaining({ code: "rateLimited" }))

      expect(sentCodes).toHaveLength(3)
      // The refused request is counted too, which is what stops a caller who is
      // already over the limit from buying a fresh allowance by carrying on.
      expect(await countAttempts(db, "sendCode:id:ada@example.com:")).toBe(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it("allows a send again once the aligned window rolls over", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"))
    try {
      const { internals, db, sentCodes } = await createTestInternals()

      for (let attempt = 0; attempt < 3; attempt++) {
        await sendVerificationCode(internals, {
          identifier: emailIdentifier,
          action: "signIn",
          locale: "en",
          headers: new Headers()
        })
        vi.advanceTimersByTime(61_000)
      }

      vi.advanceTimersByTime(10 * 60_000)
      await sendVerificationCode(internals, {
        identifier: emailIdentifier,
        action: "signIn",
        locale: "en",
        headers: new Headers()
      })

      expect(sentCodes).toHaveLength(4)
      // Nothing was reset: the window start is part of the key, so the fourth
      // send counts under a key of its own — and as the first attempt of a
      // fresh window it swept the spent windows' expired rows on the way.
      const keys = new Set(
        (await selectRows(db, "attempts"))
          .filter((row) => row.key.startsWith("sendCode:id:ada@example.com:"))
          .map((row) => row.key)
      )
      expect(keys.size).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("skips the windows and the cooldown entirely when rateLimit is false", async () => {
    const { internals, db, sentCodes } = await createTestInternals({
      rateLimit: false
    })

    await sendVerificationCode(internals, {
      identifier: emailIdentifier,
      action: "signIn",
      locale: "en",
      headers: new Headers()
    })
    await sendVerificationCode(internals, {
      identifier: emailIdentifier,
      action: "signIn",
      locale: "en",
      headers: new Headers()
    })

    // Not one counted request: no per-identifier window, no per-IP window, and
    // the second send is not held back by the cooldown either.
    expect(await selectRows(db, "attempts")).toHaveLength(0)
    expect(sentCodes).toHaveLength(2)
  })

  it("counts per-ip sends from the proxy header", async () => {
    const { internals, db } = await createTestInternals({
      ipAddress: { trustedProxies: 1 }
    })
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7" })

    await sendVerificationCode(internals, {
      identifier: emailIdentifier,
      action: "signIn",
      locale: "en",
      headers
    })

    // The key carries the aligned window start, so the assertion is on the
    // address's rows rather than on one exact key.
    expect(await countAttempts(db, "sendCode:ip:203.0.113.7:")).toBe(1)
  })
})

describe("consumeVerificationCode", () => {
  const sendAndRead = async () => {
    const context = await createTestInternals()
    await sendVerificationCode(context.internals, {
      identifier: emailIdentifier,
      action: "signIn",
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

    await consumeVerificationCode(internals, {
      identifier: "ada@example.com",
      code,
      action: "signIn"
    })

    expect(await storedCodes(db)).toHaveLength(0)
    await expect(
      consumeVerificationCode(internals, {
        identifier: "ada@example.com",
        code,
        action: "signIn"
      })
    ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))
  })

  it("rejects a sign-in code presented for deletion, and the reverse", async () => {
    const { internals, code } = await sendAndRead()

    await expect(
      consumeVerificationCode(internals, {
        identifier: "ada@example.com",
        code,
        action: "deleteUser"
      })
    ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))
  })

  it("burns the code after five wrong guesses", async () => {
    const { internals, db, code } = await sendAndRead()
    const wrongCode = code === "000000" ? "111111" : "000000"

    for (let attempt = 0; attempt < 4; attempt++) {
      await expect(
        consumeVerificationCode(internals, {
          identifier: "ada@example.com",
          code: wrongCode,
          action: "signIn"
        })
      ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))
    }
    // The budget is a row per guess in `attempts`, keyed on the code's hash
    // rather than a column on the code row — appending is what makes it hold
    // under concurrency.
    const key = await attemptKey(internals.config.secret, code)
    expect(await countAttempts(db, key)).toBe(4)
    expect(await liveCode(db)).not.toBeNull()

    await expect(
      consumeVerificationCode(internals, {
        identifier: "ada@example.com",
        code: wrongCode,
        action: "signIn"
      })
    ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))

    expect(await storedCodes(db)).toHaveLength(0)

    // Even the correct code is dead once the row is burned.
    await expect(
      consumeVerificationCode(internals, {
        identifier: "ada@example.com",
        code,
        action: "signIn"
      })
    ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))
  })

  it("lets exactly one of two concurrent valid submissions succeed", async () => {
    // Regression for the double-consume race: both requests read the row and
    // pass the HMAC check, so the conditional delete has to be the gate. A real
    // database has latency between read and delete — model it with a yield.
    const { internals, db, code } = await sendAndRead()
    const originalDelete = db.delete.bind(db)
    db.delete = async (input) => {
      if (input.table === "verificationCodes") {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      return originalDelete(input)
    }

    const results = await Promise.allSettled([
      consumeVerificationCode(internals, {
        identifier: "ada@example.com",
        code,
        action: "signIn"
      }),
      consumeVerificationCode(internals, {
        identifier: "ada@example.com",
        code,
        action: "signIn"
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
    await sendVerificationCode(internals, {
      identifier: emailIdentifier,
      action: "signIn",
      locale: "en",
      headers: new Headers()
    })
    const oldCode = required(sentCodes[0], "first code").code
    await sendVerificationCode(internals, {
      identifier: emailIdentifier,
      action: "signIn",
      locale: "en",
      headers: new Headers()
    })
    const newCode = required(sentCodes.at(-1), "resent code").code
    expect(newCode).not.toBe(oldCode)

    await expect(
      consumeVerificationCode(internals, {
        identifier: "ada@example.com",
        code: oldCode,
        action: "signIn"
      })
    ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))
    expect(await liveCode(db)).not.toBeNull()

    await consumeVerificationCode(internals, {
      identifier: "ada@example.com",
      code: newCode,
      action: "signIn"
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
      sendVerificationCode(internals, {
        identifier: emailIdentifier,
        action: "signIn",
        locale: "en",
        headers: new Headers()
      })
    await send()
    const codeA = required(sentCodes[0], "first code").code
    const wrongCode = codeA === "000000" ? "111111" : "000000"
    const guessWrong = () =>
      expect(
        consumeVerificationCode(internals, {
          identifier: "ada@example.com",
          code: wrongCode,
          action: "signIn"
        })
      ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))

    for (let attempt = 0; attempt < 4; attempt++) await guessWrong()

    const realSelect = db.select.bind(db)
    let resendOnRead = true
    db.select = async (input) => {
      const rows = await realSelect(input)
      if (resendOnRead && input.table === "verificationCodes") {
        resendOnRead = false
        await send()
      }
      return rows
    }
    await guessWrong()
    db.select = realSelect

    const codeB = required(sentCodes.at(-1), "resent code").code
    expect(codeB).not.toBe(codeA)
    // B is still there: the burn matched A's hash and found nothing. And the
    // stale guesses counted against A's key alone — B starts with a full budget,
    // so a wrong guess against it is its first, not its sixth.
    expect(
      await countAttempts(db, await attemptKey(internals.config.secret, codeA))
    ).toBe(5)
    expect(
      await countAttempts(db, await attemptKey(internals.config.secret, codeB))
    ).toBe(0)
    await guessWrong()
    expect(await liveCode(db)).not.toBeNull()
    await consumeVerificationCode(internals, {
      identifier: "ada@example.com",
      code: codeB,
      action: "signIn"
    })
  })

  it("counts concurrent wrong guesses atomically, so the cap cannot be raced past", async () => {
    // Fifty wrong guesses in flight at once, every one reading the row before
    // any has counted. A counter on the code row let them all write back 0 + 1
    // and the code survived with one attempt against it; a row appended per
    // guess cannot lose a write, so they count as fifty and the code is burned.
    // Every read is held until all fifty have happened, so the overlap is the
    // test's rather than the scheduler's. Default options, which is the
    // configuration with no per-IP limit behind the cap.
    const guesses = 50
    const { internals, db, sentCodes } = await createTestInternals()
    await sendVerificationCode(internals, {
      identifier: emailIdentifier,
      action: "signIn",
      locale: "en",
      headers: new Headers()
    })
    const code = required(sentCodes[0], "code").code
    const wrongCode = code === "000000" ? "111111" : "000000"
    let releaseReads = () => {}
    const allRead = new Promise<void>((resolve) => {
      releaseReads = resolve
    })
    let reads = 0
    const realSelect = db.select.bind(db)
    db.select = async (input) => {
      const rows = await realSelect(input)
      if (input.table === "verificationCodes") {
        reads += 1
        if (reads === guesses) releaseReads()
        await allRead
      }
      return rows
    }

    const results = await Promise.allSettled(
      Array.from({ length: guesses }, () =>
        consumeVerificationCode(internals, {
          identifier: "ada@example.com",
          code: wrongCode,
          action: "signIn"
        })
      )
    )
    db.select = realSelect

    expect(results.every((result) => result.status === "rejected")).toBe(true)
    // Every guess is on record — an append never loses one.
    expect(
      await countAttempts(db, await attemptKey(internals.config.secret, code))
    ).toBe(guesses)
    expect(await storedCodes(db)).toHaveLength(0)
    // And the right code is dead with it.
    await expect(
      consumeVerificationCode(internals, {
        identifier: "ada@example.com",
        code,
        action: "signIn"
      })
    ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))
  })

  it("rejects an expired code, and takes the row with it", async () => {
    const { internals, db, code } = await sendAndRead()
    const stored = required(await liveCode(db), "stored")
    await db.update({
      table: "verificationCodes",
      where: { id: stored.id },
      values: { expiresAt: new Date(Date.now() - 1000) }
    })

    await expect(
      consumeVerificationCode(internals, {
        identifier: "ada@example.com",
        code,
        action: "signIn"
      })
    ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))
    // The row was already in hand, so it is deleted rather than left for the
    // sweep.
    expect(await storedCodes(db)).toHaveLength(0)
  })

  it("rejects a code for an identifier that never requested one", async () => {
    const { internals } = await createTestInternals()

    await expect(
      consumeVerificationCode(internals, {
        identifier: "nobody@example.com",
        code: "123456",
        action: "signIn"
      })
    ).rejects.toThrowError(expect.objectContaining({ code: "invalidCode" }))
  })
})
