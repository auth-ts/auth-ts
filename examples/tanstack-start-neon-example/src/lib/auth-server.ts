import { waitUntil } from "cloudflare:workers"
import { createAuthServer } from "@auth-ts/server"
import { authDB } from "./auth-db"

export const authServer = createAuthServer({
  db: authDB,
  waitUntil,
  email: {
    sendCode: ({ email, code, purpose }) => {
      if (process.env.NODE_ENV === "development") {
        console.log(`${purpose} code for ${email}: ${code}`)
      }
    }
  },
  guest: true,
  multiUser: true,
  openapi: true,
  // Allowed to make state-changing requests. CORS headers are not this
  // server's business — see `src/start.ts`, which answers them for the whole
  // application. Development only: the docs site's API playground.
  ...(process.env.NODE_ENV === "development"
    ? { trustedOrigins: ["http://localhost:3001"] }
    : {}),
  providers: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string
    }
  }
})

export type AuthServer = typeof authServer
