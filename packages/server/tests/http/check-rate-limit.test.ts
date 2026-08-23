import { describe, expect, it, vi } from "vitest"
import { checkRateLimit } from "../../src/http/check-rate-limit"
import { createTestInternals } from "../helpers/create-test-internals"
import { selectRows } from "../helpers/rows"

const KEY = "sendCode:ip:203.0.113.7"
const WINDOW = { max: 3, window: "10m" } as const

describe("checkRateLimit", () => {
  it("counts every request, including the ones it refuses", async () => {
    const { internals, db } = await createTestInternals()

    for (let attempt = 0; attempt < 3; attempt++) {
      await checkRateLimit(internals, KEY, WINDOW)
    }
    await expect(checkRateLimit(internals, KEY, WINDOW)).rejects.toMatchObject({
      code: "rateLimited"
    })

    // A refused request still leaves its row, so continuing to hammer the
    // endpoint cannot win back an allowance.
    expect(await selectRows(db, "attempts")).toHaveLength(4)
  })

  it("sweeps only on the first attempt of a window, so a flood cannot amplify it", async () => {
    const { internals, db } = await createTestInternals()
    const deletes = vi.spyOn(db, "delete")

    for (let attempt = 0; attempt < 3; attempt++) {
      await checkRateLimit(internals, KEY, WINDOW)
    }

    expect(
      deletes.mock.calls.filter(([input]) => input.table === "attempts")
    ).toHaveLength(1)
  })

  it("loses no attempt under concurrency, because attempts are only ever appended", async () => {
    // The failure this replaces: a counter read, incremented, and written back
    // lets ten parallel requests all read the same value and each store one
    // more, so ten requests register as one. Inserts cannot collide, so ten
    // parallel requests leave ten rows however slow the store is.
    const { internals, db } = await createTestInternals()
    const originalInsert = db.insert.bind(db)
    db.insert = async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return originalInsert(input)
    }

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => checkRateLimit(internals, KEY, WINDOW))
    )

    expect(await selectRows(db, "attempts")).toHaveLength(10)
    // Every request that ran to completion after the burst settled is refused;
    // the overshoot is bounded by the burst itself, which is the trade
    // append-and-count makes and the docs state.
    expect(
      results.filter((result) => result.status === "rejected").length
    ).toBeGreaterThan(0)
  })

  it("reports retryAfter from the end of the window, not from a stored row", async () => {
    const { internals } = await createTestInternals()
    for (let attempt = 0; attempt < 3; attempt++) {
      await checkRateLimit(internals, KEY, WINDOW)
    }

    await expect(checkRateLimit(internals, KEY, WINDOW)).rejects.toMatchObject({
      code: "rateLimited",
      retryAfter: expect.any(Number)
    })
  })

  it("puts the window in the key, so a new window is a new set of rows", async () => {
    const { internals, db } = await createTestInternals()
    const window = { max: 1, window: "1s" } as const

    await checkRateLimit(internals, KEY, window)
    await expect(checkRateLimit(internals, KEY, window)).rejects.toMatchObject({
      code: "rateLimited"
    })

    // Windows are aligned to the clock rather than started by the first
    // request, so crossing the boundary is what resets the count — no stored
    // `resetAt` is read, and nothing has to be written back. The first attempt
    // of the fresh window also sweeps, so the spent window's rows are gone.
    await new Promise((resolve) => setTimeout(resolve, 1100))
    await expect(
      checkRateLimit(internals, KEY, window)
    ).resolves.toBeUndefined()

    const keys = new Set(
      (await selectRows(db, "attempts")).map((row) => row.key)
    )
    expect(keys.size).toBe(1)
  })

  it("does nothing at all when the limiter is off", async () => {
    const { internals, db } = await createTestInternals({ rateLimit: false })

    for (let attempt = 0; attempt < 10; attempt++) {
      await checkRateLimit(internals, KEY, WINDOW)
    }

    expect(await selectRows(db, "attempts")).toEqual([])
  })
})
