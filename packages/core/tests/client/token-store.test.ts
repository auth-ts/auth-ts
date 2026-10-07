import { describe, expect, it, vi } from "vitest"
import { createTokenStore } from "../../src/client/core/token-store"
import { fakeAccessToken } from "./helpers/fake-auth-server"

describe("createTokenStore", () => {
  it("scales the refresh buffers down for short-lived tokens", () => {
    vi.useFakeTimers()
    try {
      const store = createTokenStore()
      store.set(fakeAccessToken({ lifetimeSeconds: 30 }))

      expect(store.isExpiringSoon()).toBe(false)
      expect(store.mustRefresh()).toBe(false)

      vi.setSystemTime(Date.now() + 20_000)
      expect(store.isExpiringSoon()).toBe(true)
      expect(store.mustRefresh()).toBe(false)

      vi.setSystemTime(Date.now() + 5_000)
      expect(store.mustRefresh()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

it("keeps a newer flight when an invalidated flight finishes", async () => {
  const store = createTokenStore()
  let releaseOld = () => {}
  let releaseNew = () => {}
  const old = new Promise<string>((resolve) => {
    releaseOld = () => resolve("old")
  })
  const next = new Promise<string>((resolve) => {
    releaseNew = () => resolve("new")
  })
  const oldRead = store.singleFlight(() => old)
  store.invalidate()
  const newRead = store.singleFlight(() => next)
  releaseOld()
  expect(await oldRead).toBe("old")
  const duplicate = store.singleFlight(() => Promise.resolve("wrong"))
  releaseNew()
  expect(await newRead).toBe("new")
  expect(await duplicate).toBe("new")
})
