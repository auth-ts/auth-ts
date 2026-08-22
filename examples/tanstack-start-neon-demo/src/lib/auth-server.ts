import { createAuthServer } from "@auth-ts/server"
import { authDB } from "./auth-db"

export const authServer = createAuthServer({
  db: authDB,
  email: {
    sendCode: ({ email, code, purpose }) => {
      if (process.env.NODE_ENV === "development") {
        console.log(`${purpose} code for ${email}: ${code}`)
      }
    }
  },
  guest: true,
  multiAccount: true,
  // Loaders read the session during SSR, so the cookie must reach page requests.
  cookie: { path: "/" },
  providers: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string
    }
  }
})

export type AuthServer = typeof authServer
