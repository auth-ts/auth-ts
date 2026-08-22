import { getDiscovery } from "../endpoints/.well-known/openid-configuration.ts"
import { switchAccount } from "../endpoints/accounts/switch.ts"
import { listAccounts } from "../endpoints/accounts.ts"
import { callbackProvider } from "../endpoints/callback/$provider.ts"
import { connectProvider } from "../endpoints/connect/$provider.ts"
import { disconnectProvider } from "../endpoints/connections/$provider.ts"
import { listConnections } from "../endpoints/connections.ts"
import { getJwks } from "../endpoints/jwks.ts"
import { logout } from "../endpoints/logout.ts"
import { sendCode } from "../endpoints/send-code.ts"
import { revokeSession } from "../endpoints/sessions/$id.ts"
import { listSessions } from "../endpoints/sessions.ts"
import { signInProvider } from "../endpoints/sign-in/$provider.ts"
import { signInGuest } from "../endpoints/sign-in/guest.ts"
import { getToken } from "../endpoints/token.ts"
import { deleteUser, getUser, updateUser } from "../endpoints/user.ts"
import { verifyCode } from "../endpoints/verify-code.ts"

/**
 * Every endpoint, keyed by the name it is exposed under.
 *
 * One table, three consumers: the callables on `authServer`, the handlers in
 * `authServer.handlers`, and the dispatch table behind `authServer.handler`.
 * Adding an endpoint here adds it to all three, which is the point — there is no
 * second list to forget.
 *
 * Names are derived from the route, so `GET /connect/:provider` is
 * `connectProvider` and reading either one tells you the other.
 */
export const endpointRegistry = {
  sendCode,
  verifyCode,
  getToken,
  logout,
  getUser,
  updateUser,
  deleteUser,
  listSessions,
  revokeSession,
  listAccounts,
  switchAccount,
  signInGuest,
  signInProvider,
  callbackProvider,
  connectProvider,
  listConnections,
  disconnectProvider,
  getJwks,
  getDiscovery
} as const

/** The registry's shape, used to type the derived surfaces. */
export type EndpointRegistry = typeof endpointRegistry
