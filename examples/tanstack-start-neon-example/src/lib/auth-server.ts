import { waitUntil } from "cloudflare:workers"
import { createAuthServer } from "@auth-ts/server"
import { authDB } from "./auth-db"

export const authServer = createAuthServer({
  db: authDB,
  waitUntil,
  email: {
    sendCode: ({ email, code, action }) => {
      if (process.env.NODE_ENV === "development") {
        console.log(`${action} code for ${email}: ${code}`)
      }
    }
  },
  guest: true,
  multiAccount: true,
  providers: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string
    }
  }
})

export type AuthServer = typeof authServer
