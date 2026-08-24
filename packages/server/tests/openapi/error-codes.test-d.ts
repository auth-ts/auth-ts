import { assertType, describe, it } from "vitest"
import type { AuthErrorCode } from "../../src/http/error-response"
import type { ERROR_CODES } from "../../src/openapi/components"

type Listed = (typeof ERROR_CODES)[number]

describe("the documented error codes", () => {
  it("lists every code the library can return, and no others", () => {
    // Both directions: a `never` on either side means the two agree exactly.
    assertType<never>(null as unknown as Exclude<AuthErrorCode, Listed>)
    assertType<never>(null as unknown as Exclude<Listed, AuthErrorCode>)
  })
})
