import { waitUntil } from "cloudflare:workers"
import { createAuth } from "@auth-ts/core"
import { authDatabase } from "./auth-database"

export const auth = createAuth({
  database: authDatabase,
  waitUntil,
  // The key in .env predates the ES256 default
  jwt: { alg: "RS256" },
  email: {
    sendCode: ({ email, code, purpose }) => {
      if (process.env.NODE_ENV === "development") {
        console.log(`${purpose} code for ${email}: ${code}`)
      }
    },
    sendSignedInNotification: ({ email, session }) => {
      if (process.env.NODE_ENV === "development") {
        console.log(
          `New sign-in to your account (${email}): We detected a recent login to your account. If this wasn't you, please secure your account immediately. Session ${session.id}, ${session.userAgent ?? "unknown device"}`
        )
      }
    }
  },
  guest: true,
  multiUser: true,
  openapi: true,
  // Docs playground; CORS lives in start.ts
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
