import { createAuth } from "@auth-ts/core"
import { authDatabase } from "./auth-database"

export const auth = createAuth({
  database: authDatabase,
  email: {
    sendCode: async ({ email, code }) => {
      // Swap for your email provider before deploying.
      console.log(`Sign-in code for ${email}: ${code}`)
    }
  }
})
