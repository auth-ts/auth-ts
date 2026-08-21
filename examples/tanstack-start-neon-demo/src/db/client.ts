import { drizzle } from "drizzle-orm/neon-http"

/** The server-side connection. Owner credentials, never reached from the browser. */
export const db = drizzle(process.env.DATABASE_URL ?? "")
