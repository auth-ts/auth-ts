import { createAuthServer } from "@auth-ts/server"
import { authDB } from "./auth-db"

export const authServer = createAuthServer({
  db: authDB,
  email: {
    sendCode: ({ email, code, purpose }) => {
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          "The console email transport must not run in production. Replace sendCode with a real email provider."
        )
      }
      console.log(
        `\n  ✉️  ${purpose === "deleteUser" ? "Deletion" : "Sign-in"} code for ${email}: ${code}\n`
      )
    }
  },
  guest: true,
  multiAccount: true,
  // The number of proxies in front of this app: 1 on Cloudflare, 0 when reached directly.
  clientIp: { trustedProxies: Number(process.env.AUTH_TRUSTED_PROXIES ?? 0) },
  // Loaders read the session during SSR, so the cookie must reach page requests.
  cookie: { path: "/" },
  logLevel: "info",
  providers: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string
    }
  }
})

export type AuthServer = typeof authServer
