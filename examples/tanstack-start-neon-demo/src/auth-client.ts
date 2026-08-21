import { createAuthClient } from "@auth-ts/client"

/**
 * The browser client.
 *
 * Constructing it is free — no network, no storage — so importing this module
 * anywhere, including during server-side rendering, costs nothing.
 */
export const authClient = createAuthClient()
