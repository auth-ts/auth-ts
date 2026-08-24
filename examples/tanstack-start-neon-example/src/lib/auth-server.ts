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
  multiAccount: true,
  openapi: true,
  // The docs site runs on another port, so its API playground is cross-origin
  // and the browser withholds the refresh cookie unless the origin is allowed
  // by name. Without this `GET /token` there always answers null. Development
  // only: this is also the one other origin allowed to change state.
  ...(process.env.NODE_ENV === "development"
    ? { cors: { origin: "http://localhost:3001" } }
    : {}),
  providers: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string
    }
  }
})

export type AuthServer = typeof authServer
