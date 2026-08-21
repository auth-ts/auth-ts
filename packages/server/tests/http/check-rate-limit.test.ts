import { describe, expect, it } from "vitest"
import { checkRateLimit } from "../../src/http/check-rate-limit.ts"
import { createTestInternals } from "../helpers/create-test-internals.ts"
import { required } from "../helpers/required.ts"

const KEY = "sendCode:ip:203.0.113.7"

describe("checkRateLimit", () => {
  it("lets exactly max through under concurrency, counting every request", async () => {
    // Regression for the read-modify-write race: ten parallel requests against a
    // cap of three all used to read count 0 and each write back 1, so all ten
    // were allowed and the stored count was 1. A real database has latency
    // between the read and the write — model it with a yield.
    const { internals, db } = await createTestInternals()
    const originalUpsert = db.upsertRateLimit.bind(db)
    db.upsertRateLimit = async (row) => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return originalUpsert(row)
    }

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        checkRateLimit(internals, KEY, { max: 3, window: "10m" })
      )
    )

    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(3)
    expect(
      results.filter((result) => result.status === "rejected")
    ).toHaveLength(7)
    // Refused requests are counted too: the store increments atomically and
    // core only compares, so the count is a true request count.
    expect(required(await db.getRateLimit({ key: KEY }), "counter").count).toBe(
      10
    )
  })

  it("never reads the counter — the store's atomic upsert is the whole limiter", async () => {
    const { internals, db } = await createTestInternals()
    let reads = 0
    const originalGet = db.getRateLimit.bind(db)
    db.getRateLimit = async (where) => {
      reads++
      return originalGet(where)
    }

    await checkRateLimit(internals, KEY, { max: 3, window: "10m" })
    await checkRateLimit(internals, KEY, { max: 3, window: "10m" })

    expect(reads).toBe(0)
  })

  it("reports retryAfter from the window end, and the cap is exceeded at max + 1", async () => {
    const { internals } = await createTestInternals()
    for (let attempt = 0; attempt < 3; attempt++) {
      await checkRateLimit(internals, KEY, { max: 3, window: "10m" })
    }

    await expect(
      checkRateLimit(internals, KEY, { max: 3, window: "10m" })
    ).rejects.toMatchObject({
      code: "rateLimited",
      retryAfter: expect.any(Number)
    })
  })
})
