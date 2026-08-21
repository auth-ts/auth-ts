import { describe, expect, it } from "vitest"
import { getClientIp } from "../../src/lib/get-client-ip.ts"

describe("getClientIp", () => {
  it("takes the leftmost X-Forwarded-For entry", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178"
    })
    expect(getClientIp(headers)).toBe("203.0.113.7")
  })

  it("falls back to X-Real-IP", () => {
    expect(getClientIp(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe(
      "203.0.113.9"
    )
  })

  it("prefers X-Forwarded-For when both are present", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.7",
      "x-real-ip": "203.0.113.9"
    })
    expect(getClientIp(headers)).toBe("203.0.113.7")
  })

  it("returns undefined when no proxy header is set, so ip limits are skipped", () => {
    expect(getClientIp(new Headers())).toBeUndefined()
    expect(
      getClientIp(new Headers({ "x-forwarded-for": "  " }))
    ).toBeUndefined()
  })
})
