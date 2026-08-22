import { drizzle } from "drizzle-orm/neon-http"

// No `dotenv/config` here: this module is bundled into the Worker, which has no
// filesystem to read `.env` from. `process.env` is populated by the Cloudflare
// Vite plugin in dev and by `nodejs_compat` from vars and secrets in production.
export const db = drizzle(process.env.DATABASE_URL as string)
