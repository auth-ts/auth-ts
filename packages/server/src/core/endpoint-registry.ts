import { getDiscovery } from "../endpoints/.well-known/openid-configuration"
import { listAccounts } from "../endpoints/accounts"
import { switchAccount } from "../endpoints/accounts/switch"
import { callbackProvider } from "../endpoints/callback/$provider"
import { connectProvider } from "../endpoints/connect/$provider"
import { listIdentities } from "../endpoints/identities"
import { disconnectIdentity } from "../endpoints/identities/$id"
import { getProviderToken } from "../endpoints/identities/$id/token"
import { getJwks } from "../endpoints/jwks"
import { getOpenAPIDocument } from "../endpoints/openapi"
import { getReference } from "../endpoints/reference"
import { getSession } from "../endpoints/session"
import { listSessions } from "../endpoints/sessions"
import { revokeSession } from "../endpoints/sessions/$id"
import { signInWithCode } from "../endpoints/sign-in/code"
import { signInAsGuest } from "../endpoints/sign-in/guest"
import { signInWithProvider } from "../endpoints/sign-in/provider/$provider"
import { sendSignInCode } from "../endpoints/sign-in/send-code"
import { signOut } from "../endpoints/sign-out"
import { getToken } from "../endpoints/token"
import { deleteUser, getUser, updateUser } from "../endpoints/user"
import { sendDeleteUserCode } from "../endpoints/user/send-delete-code"

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
  sendSignInCode,
  getToken,
  signInWithCode,
  signOut,
  getSession,
  getUser,
  updateUser,
  deleteUser,
  sendDeleteUserCode,
  listSessions,
  revokeSession,
  listAccounts,
  switchAccount,
  signInAsGuest,
  signInWithProvider,
  callbackProvider,
  connectProvider,
  listIdentities,
  disconnectIdentity,
  getProviderToken,
  getJwks,
  getDiscovery,
  getOpenAPIDocument,
  getReference
} as const

/** The registry's shape, used to type the derived surfaces. */
export type EndpointRegistry = typeof endpointRegistry
