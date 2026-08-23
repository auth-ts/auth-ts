import { authDBChecks } from "@auth-ts/server/testing"
import { describe, it } from "vitest"
import { authDB } from "../src/lib/auth-db"

// The file people copy, held to the contract it claims to implement.
describe("authDB", () => {
  for (const check of authDBChecks) {
    it(check.name, () => check.run(authDB))
  }
})
