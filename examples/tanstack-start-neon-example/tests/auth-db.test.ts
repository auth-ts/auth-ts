import { authDatabaseChecks } from "@auth-ts/core/testing"
import { describe, it } from "vitest"
import { authDatabase } from "../src/lib/auth-database"

// The file people copy, held to the contract it claims to implement.
describe("authDatabase", () => {
  for (const check of authDatabaseChecks) {
    it(check.name, () => check.run(authDatabase))
  }
})
