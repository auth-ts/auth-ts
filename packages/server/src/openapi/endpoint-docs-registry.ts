import type { EndpointRegistry } from "../core/endpoint-registry"
import { getDiscoveryDocs } from "../endpoints/.well-known/openid-configuration"
import { listAccountsDocs } from "../endpoints/accounts"
import { switchAccountDocs } from "../endpoints/accounts/switch"
import { callbackProviderDocs } from "../endpoints/callback/$provider"
import { connectProviderDocs } from "../endpoints/connect/$provider"
import { listIdentitiesDocs } from "../endpoints/identities"
import { disconnectIdentityDocs } from "../endpoints/identities/$id"
import { getProviderTokenDocs } from "../endpoints/identities/$id/token"
import { getJwksDocs } from "../endpoints/jwks"
import { sendCodeDocs } from "../endpoints/send-code"
import { getSessionDocs } from "../endpoints/session"
import { listSessionsDocs } from "../endpoints/sessions"
import { revokeSessionDocs } from "../endpoints/sessions/$id"
import { signInCodeDocs } from "../endpoints/sign-in/code"
import { signInGuestDocs } from "../endpoints/sign-in/guest"
import { signInProviderDocs } from "../endpoints/sign-in/provider/$provider"
import { signOutDocs } from "../endpoints/sign-out"
import { getTokenDocs } from "../endpoints/token"
import { deleteUserDocs, getUserDocs, updateUserDocs } from "../endpoints/user"
import type { AnyEndpointDocs } from "./endpoint-docs"

// Declared here rather than beside their endpoints: both serve this document,
// so a docs const in their own file would close an import cycle.
const getOpenAPIDocumentDocs: AnyEndpointDocs = {
  description: "Matches this server's own configuration.",
  tag: "Discovery",
  auth: "none",
  responses: {
    200: { description: "The OpenAPI document.", schema: { type: "object" } }
  }
}

const getReferenceDocs: AnyEndpointDocs = {
  tag: "Discovery",
  auth: "none",
  responses: {
    200: { description: "The reference page.", contentType: "text/html" }
  }
}

/**
 * Each endpoint's OpenAPI metadata, keyed the way the registry is.
 *
 * A separate table rather than a field on the endpoint, so the metadata is a
 * distinct export a bundler can drop for consumers who never serve the
 * document. It still lives beside `run`, in the endpoint's own file. The mapped
 * type is what makes a forgotten endpoint a build error rather than a gap.
 */
export const endpointDocs: {
  [Name in keyof EndpointRegistry]: AnyEndpointDocs
} = {
  sendCode: sendCodeDocs,
  getToken: getTokenDocs,
  signInCode: signInCodeDocs,
  signOut: signOutDocs,
  getSession: getSessionDocs,
  getUser: getUserDocs,
  updateUser: updateUserDocs,
  deleteUser: deleteUserDocs,
  listSessions: listSessionsDocs,
  revokeSession: revokeSessionDocs,
  listAccounts: listAccountsDocs,
  switchAccount: switchAccountDocs,
  signInGuest: signInGuestDocs,
  signInProvider: signInProviderDocs,
  callbackProvider: callbackProviderDocs,
  connectProvider: connectProviderDocs,
  listIdentities: listIdentitiesDocs,
  disconnectIdentity: disconnectIdentityDocs,
  getProviderToken: getProviderTokenDocs,
  getJwks: getJwksDocs,
  getDiscovery: getDiscoveryDocs,
  getOpenAPIDocument: getOpenAPIDocumentDocs,
  getReference: getReferenceDocs
}

/**
 * Each operation's one-line summary.
 *
 * The first line of the endpoint's own doc comment, less its full stop — a
 * summary is a label in a sidebar rather than a sentence. A test holds the two
 * together. It is copied rather than read because reading it means reading
 * source files, and no edge runtime can do that.
 */
export const summaries: { [Name in keyof EndpointRegistry]: string } = {
  sendCode: "Send a sign-in code",
  getToken: "Get a new access token, or null when nobody is signed in",
  signInCode: "Verify a code and start a session",
  signOut: "Sign out",
  getSession: "Get the current user's session",
  getUser: "Get the current user",
  updateUser: "Update the current user",
  deleteUser: "Delete the current user",
  listSessions: "List the current user's sessions",
  revokeSession: "Revoke a session",
  listAccounts: "List the accounts signed in to this browser",
  switchAccount: "Switch to another signed-in account",
  signInGuest: "Sign in as a guest",
  signInProvider: "Start an OAuth sign-in",
  callbackProvider: "Finish an OAuth flow",
  connectProvider: "Start linking a provider",
  listIdentities: "List the current user's linked providers",
  disconnectIdentity: "Unlink a connected provider",
  getProviderToken: "Get a provider access token",
  getJwks: "Get the public key set",
  getDiscovery: "Get the OIDC discovery document",
  getOpenAPIDocument: "Get the OpenAPI document",
  getReference: "Get the browsable API reference"
}
