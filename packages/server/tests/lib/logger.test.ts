import { describe, expect, it, vi } from "vitest"
import { createLogger } from "../../src/lib/logger"

describe("createLogger", () => {
  it("emits nothing at silent", () => {
    const sink = vi.fn()
    const log = createLogger("silent", sink)
    log.error("boom")
    log.warn("hmm")
    log.info("fyi")
    log.debug("trace")
    expect(sink).not.toHaveBeenCalled()
  })

  it("filters by level, defaulting to warn", () => {
    const sink = vi.fn()
    const log = createLogger("warn", sink)
    log.error("boom")
    log.warn("hmm")
    log.info("fyi")
    log.debug("trace")
    expect(sink.mock.calls.map((call) => call[0])).toEqual(["error", "warn"])
  })

  it("passes message and structured data through to a custom sink", () => {
    const sink = vi.fn()
    createLogger("debug", sink).debug("resolved session", {
      path: "/api/auth/token"
    })
    expect(sink).toHaveBeenCalledWith("debug", "resolved session", {
      path: "/api/auth/token"
    })
  })

  it("emits every level at debug", () => {
    const sink = vi.fn()
    const log = createLogger("debug", sink)
    log.error("a")
    log.warn("b")
    log.info("c")
    log.debug("d")
    expect(sink).toHaveBeenCalledTimes(4)
  })
})
