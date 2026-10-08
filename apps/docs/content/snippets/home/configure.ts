declare function sendEmail(context: {
  email: string
  code: string
}): Promise<void>

// ---cut---
import { createAuth } from "@auth-ts/core"
import { authDatabase } from "./auth-database"

export const auth = createAuth({
  database: authDatabase,
  email: { sendCode: sendEmail }
})
