import { getDiscovery } from "../endpoints/.well-known/openid-configuration"
import { callbackProvider } from "../endpoints/callback/$provider"
import { getProviderToken } from "../endpoints/identities/$id/token"
import { connectProvider } from "../endpoints/identities/connect/$provider"
import { getJwks } from "../endpoints/jwks"
import { getOpenAPIDocument } from "../endpoints/openapi"
import { getReference } from "../endpoints/reference"
import { signInWithCode } from "../endpoints/sign-in/code"
import { signInAsGuest } from "../endpoints/sign-in/guest"
import { signInWithProvider } from "../endpoints/sign-in/provider/$provider"
import { sendSignInCode } from "../endpoints/sign-in/send-code"
import { signOut } from "../endpoints/sign-out"
import { getToken } from "../endpoints/token"
import { deleteUser, updateUser } from "../endpoints/user"
import { sendDeleteUserCode } from "../endpoints/user/send-delete-code"
import { listUsers } from "../endpoints/users"
import { switchUser } from "../endpoints/users/switch"

/**
 * Every endpoint, keyed by the name it is exposed under.
 *
 * One table, three consumers: the callables on `authServer`, the handlers in
 * `authServer.handlers`, and the dispatch table behind `authServer.handler`.
 * Adding an endpoint here adds it to all three, which is the point — there is no
 * second list to forget.
 *
 * Keyed to match each endpoint's own exported const, so this file and the
 * endpoint's own file agree with no cross-reference needed.
 */
export const endpointRegistry = {
  sendSignInCode,
  getToken,
  signInWithCode,
  signOut,
  updateUser,
  deleteUser,
  sendDeleteUserCode,
  listUsers,
  switchUser,
  signInAsGuest,
  signInWithProvider,
  callbackProvider,
  connectProvider,
  getProviderToken,
  getJwks,
  getDiscovery,
  getOpenAPIDocument,
  getReference
} as const

/** The registry's shape, used to type the derived surfaces. */
export type EndpointRegistry = typeof endpointRegistry
