import { describe, expect, it, vi } from "vitest"
import { checkRateLimit } from "../../src/http/check-rate-limit"
import { createTestInternals } from "../helpers/create-test-internals"
import { required } from "../helpers/required"
import { selectRow, selectRows } from "../helpers/rows"

const KEY = "send:ada@example.com"
const BUCKET = { capacity: 3, refill: "1m" } as const

describe("checkRateLimit", () => {
  it("hands out capacity tokens, then refuses with the time to the next one", async () => {
    vi.useFakeTimers()
    try {
      const { internals, db } = await createTestInternals()

      for (let attempt = 0; attempt < 3; attempt++) {
        await checkRateLimit(internals, KEY, BUCKET)
      }
      vi.advanceTimersByTime(15_000)
      await expect(
        checkRateLimit(internals, KEY, BUCKET)
      ).rejects.toMatchObject({ code: "rateLimited", retryAfter: 45 })

      // One bucket, one row, however many requests.
      const rows = await selectRows(db, "rateLimits")
      expect(rows).toHaveLength(1)
      expect(required(rows[0], "bucket").tokenCount).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("refills one token per interval and never past capacity", async () => {
    vi.useFakeTimers()
    try {
      const { internals, db } = await createTestInternals()
      const tokens = async () =>
        required(
          await selectRow(db, "rateLimits", { key: { eq: KEY } }),
          "bucket"
        ).tokenCount

      for (let attempt = 0; attempt < 3; attempt++) {
        await checkRateLimit(internals, KEY, BUCKET)
      }
      expect(await tokens()).toBe(0)

      vi.advanceTimersByTime(60_000)
      await checkRateLimit(internals, KEY, BUCKET)
      expect(await tokens()).toBe(0)
      await expect(
        checkRateLimit(internals, KEY, BUCKET)
      ).rejects.toMatchObject({ code: "rateLimited" })

      // An hour idle refills to capacity, not to sixty.
      vi.advanceTimersByTime(60 * 60_000)
      await checkRateLimit(internals, KEY, BUCKET)
      expect(await tokens()).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("writes nothing when it refuses", async () => {
    const { internals, db } = await createTestInternals()
    for (let attempt = 0; attempt < 3; attempt++) {
      await checkRateLimit(internals, KEY, BUCKET)
    }
    const updates = vi.spyOn(db, "update")
    const inserts = vi.spyOn(db, "insert")

    await expect(checkRateLimit(internals, KEY, BUCKET)).rejects.toMatchObject({
      code: "rateLimited"
    })

    expect(updates).not.toHaveBeenCalled()
    expect(inserts).not.toHaveBeenCalled()
  })

  it("never hands out more than capacity under concurrency", async () => {
    // Every consumer reads the same bucket; the conditional update lets only
    // one of them take each token, and the losers read again.
    const { internals, db } = await createTestInternals()
    const originalUpdate = db.update.bind(db)
    db.update = async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 2))
      return originalUpdate(input)
    }
    await checkRateLimit(internals, KEY, BUCKET)

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => checkRateLimit(internals, KEY, BUCKET))
    )

    const admitted = results.filter((result) => result.status === "fulfilled")
    expect(admitted.length).toBeGreaterThanOrEqual(1)
    expect(admitted.length).toBeLessThanOrEqual(2)
    expect(
      required(
        await selectRow(db, "rateLimits", { key: { eq: KEY } }),
        "bucket"
      ).tokenCount
    ).toBe(2 - admitted.length)
  })

  it("settles two first requests on a fresh key through the unique key", async () => {
    const { internals, db } = await createTestInternals()
    const originalInsert = db.insert.bind(db)
    db.insert = async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 2))
      return originalInsert(input)
    }

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => checkRateLimit(internals, KEY, BUCKET))
    )

    expect(
      results.filter((result) => result.status === "fulfilled").length
    ).toBeGreaterThanOrEqual(1)
    expect(await selectRows(db, "rateLimits")).toHaveLength(1)
  })

  it("sweeps full buckets on a fresh key only, so a flood cannot amplify it", async () => {
    vi.useFakeTimers()
    try {
      const { internals, db } = await createTestInternals()
      const deletes = vi.spyOn(db, "delete")

      for (let attempt = 0; attempt < 3; attempt++) {
        await checkRateLimit(internals, KEY, BUCKET)
      }
      expect(
        deletes.mock.calls.filter(([input]) => input.table === "rateLimits")
      ).toHaveLength(1)

      // Long enough for every configured bucket to have refilled.
      vi.advanceTimersByTime(3 * 60 * 60_000)
      await checkRateLimit(internals, "send:grace@example.com", BUCKET)

      const keys = (await selectRows(db, "rateLimits")).map((row) => row.key)
      expect(keys).toEqual(["send:grace@example.com"])
    } finally {
      vi.useRealTimers()
    }
  })
})
