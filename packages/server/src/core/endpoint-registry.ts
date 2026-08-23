import { getDiscovery } from "../endpoints/.well-known/openid-configuration"
import { listAccounts } from "../endpoints/accounts"
import { switchAccount } from "../endpoints/accounts/switch"
import { callbackProvider } from "../endpoints/callback/$provider"
import { connectProvider } from "../endpoints/connect/$provider"
import { listConnections } from "../endpoints/connections"
import { disconnectProvider } from "../endpoints/connections/$provider"
import { getJwks } from "../endpoints/jwks"
import { sendCode } from "../endpoints/send-code"
import { getSession } from "../endpoints/session"
import { listSessions } from "../endpoints/sessions"
import { revokeSession } from "../endpoints/sessions/$id"
import { signInProvider } from "../endpoints/sign-in/$provider"
import { signInGuest } from "../endpoints/sign-in/guest"
import { signOut } from "../endpoints/sign-out"
import { getToken } from "../endpoints/token"
import { deleteUser, getUser, updateUser } from "../endpoints/user"
import { verifyCode } from "../endpoints/verify-code"

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
  signOut,
  getSession,
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
