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
