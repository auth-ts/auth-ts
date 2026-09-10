import { describe, expect, it } from "vitest"
import { AuthApiError } from "../../src/http/auth-api-error"
import { ERROR_STATUS } from "../../src/http/error-response"

describe("AuthApiError", () => {
  it("derives the status from the code", () => {
    expect(new AuthApiError("notFound").status).toBe(404)
    expect(new AuthApiError("rateLimited").status).toBe(
      ERROR_STATUS.rateLimited
    )
  })

  it("lets a caller override the status", () => {
    expect(new AuthApiError("notFound", { status: 410 }).status).toBe(410)
  })

  it("interpolates retryAfter into the message", () => {
    expect(new AuthApiError("cooldown", { retryAfter: 7 }).message).toContain(
      "7"
    )
  })
})
