import { waitUntil } from "cloudflare:workers"
import { createAuth } from "@auth-ts/core"
import { authDatabase } from "./auth-database"

export const auth = createAuth({
  database: authDatabase,
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

export type Auth = typeof auth
