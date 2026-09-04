import type { AuthInternals } from "../../core/auth-internals"
import {
  AuthApiError,
  isAuthApiError,
  notFound,
  unauthenticated
} from "../../http/auth-api-error"
import { defineEndpoint } from "../../http/define-endpoint"
import type { AuthErrorCode } from "../../http/error-response"
import { validateAdditionalFields } from "../../http/validate-additional-fields"
import { selectOne } from "../../lib/select-one"
import { shouldUseSecureCookies } from "../../lib/serialize-cookie"
import { getCallbackURL } from "../../oauth/callback-url"
import { linkIdentity } from "../../oauth/link-identity"
import { getProvider } from "../../oauth/providers/get-provider"
import type { ProviderIdentity } from "../../oauth/providers/oauth-provider"
import { PROVIDER_DEADLINE_MS } from "../../oauth/providers/provider-response"
import { resolveOAuthUser } from "../../oauth/resolve-oauth-user"
import type { OAuthStatePayload } from "../../oauth/state-cookie"
import { clearStateCookie, readStateCookie } from "../../oauth/state-cookie"
import type { EndpointDocs } from "../../openapi/endpoint-docs"
import { issueSession } from "../../session/issue-session"
import type { ResolvedSession } from "../../session/resolve-session"
import { resolveCallerSession } from "../../session/resolve-session"

/** Input for finishing an OAuth flow. */
export interface CallbackProviderInput {
  provider: string
  code: string | null
  state: string | null
  /** Set when the provider itself reported a failure, e.g. the user cancelled. */
  providerError: string | null
  headers: Headers
  requestURL: string
}

/** How `GET /callback/$provider` appears in the OpenAPI document. */
export const callbackProviderDocs: EndpointDocs<
  CallbackProviderInput,
  "provider"
> = {
  description: "The provider redirects here. Not called directly.",
  tag: "Sign in",
  auth: "none",
  requires: "providers",
  params: { provider: "The provider the flow started with." },
  query: {
    code: { type: "string", description: "The provider's authorization code." },
    state: { type: "string", description: "Must match the state cookie." },
    error: {
      type: "string",
      description:
        "Set when the provider reported a failure, e.g. the user cancelled."
    }
  },
  responses: {
    302: {
      description:
        "Redirects to the `redirect` recorded at the start, with `?error=` when the flow failed.",
      setsCookie: "refresh",
      redirect: true
    }
  }
}

/**
 * Provider callback.
 *
 * One callback serves both because the provider only ever gets one redirect URI.
 * The `intent` recorded in the state cookie decides what happens here, which is
 * what keeps "sign in with GitHub" from ever silently linking GitHub to whoever
 * is currently signed in.
 */
export const callbackProvider = defineEndpoint({
  method: "GET",
  path: "/callback/$provider",
  parse: ({ request, params }): CallbackProviderInput => {
    const url = new URL(request.url)

    return {
      provider: params.provider ?? "",
      code: url.searchParams.get("code"),
      state: url.searchParams.get("state"),
      providerError: url.searchParams.get("error"),
      headers: request.headers,
      requestURL: request.url
    }
  },
  run: async (internals, input: CallbackProviderInput) => {
    const { config } = internals
    const configured = getProvider(config.providers, input.provider)
    if (!configured) throw notFound()

    const secure = shouldUseSecureCookies(input.requestURL)
    const clearState = clearStateCookie(internals, input.provider, secure)

    // A failure answers where the flow said to, then where the server is
    // configured to live. Only a server with neither says so in JSON.
    let payload: OAuthStatePayload | undefined
    try {
      // Verified before anything else is trusted, and the cookie is cleared
      // whichever way this goes so a state value is never replayable.
      payload = await readStateCookie(
        internals,
        input.headers,
        input.state,
        input.provider
      )

      if (input.providerError || !input.code)
        throw new AuthApiError("providerDenied", 401)

      // Validated again here, not trusted from the cookie. The signature proves
      // the payload came from this server; it does not prove the fields are
      // still declared, or that every path able to sign a payload validated
      // them first. The write is what matters, so the check sits next to it —
      // otherwise an undeclared column rides into user creation.
      const additionalFields = validateAdditionalFields(
        config.user.additionalFields,
        payload.additionalFields
      )

      let identity: ProviderIdentity
      try {
        identity = await configured.provider.exchangeCode({
          credentials: configured.credentials,
          redirectURI: getCallbackURL(
            config,
            input.provider,
            input.requestURL,
            input.headers
          ),
          code: input.code,
          codeVerifier: payload.codeVerifier,
          nonce: payload.nonce,
          signal: AbortSignal.timeout(PROVIDER_DEADLINE_MS)
        })
      } catch (error) {
        // A rejected code is the provider's verdict; anything else — the
        // deadline, a DNS failure — is the provider being unreachable.
        if (isAuthApiError(error)) throw error
        internals.log.error("oauth provider request failed", {
          provider: input.provider,
          error: String(error)
        })
        throw new AuthApiError("providerUnavailable", 502)
      }

      const active = await resolveCallerSession(internals, input)

      // Linking only means linking for a real user. A guest who "connects" a
      // provider is really signing in: the identity decides whether they upgrade
      // in place or merge into the account it already belongs to, and they get a
      // session for the result — exactly what `/sign-in/provider/:provider` would do.
      if (payload.intent === "connect" && active?.user.type !== "guest") {
        return await connectIdentity(
          internals,
          input,
          active,
          payload.userId,
          identity,
          clearState,
          payload.redirect
        )
      }

      // A signed-in guest converts rather than creating a new user. The lookup
      // lives inside resolveOAuthUser so the guest path runs the same
      // identity-first cascade as everyone else — a provider account already
      // linked to an account is never silently re-pointed at the guest.
      const user = await resolveOAuthUser(internals, input.provider, identity, {
        additionalFields,
        ...(active?.user.type === "guest" ? { guest: active.user } : {})
      })

      const issued = await issueSession(internals, {
        user,
        headers: input.headers,
        amr: ["fed"],
        requestURL: input.requestURL,
        // The guest's session has done its job either way — see `convertGuest`.
        ...(active?.user.type === "guest" ? { replaces: active.tokenHash } : {})
      })

      const headers = new Headers(issued.headers)
      headers.append("set-cookie", clearState)
      headers.set("location", payload.redirect)

      return { data: undefined, status: 302, headers }
    } catch (error) {
      if (!isAuthApiError(error)) throw error
      const target = payload?.errorRedirect ?? config.baseURL
      if (!target) throw error
      return errorRedirect(error.code, clearState, target)
    }
  }
})

/**
 * Links the provider identity to the user who started the flow.
 *
 * Requiring the *same* session is the whole security of this branch. Without it,
 * an attacker who lures a signed-in victim through a connect URL would attach
 * their own provider identity to the victim's account, and then sign in as them
 * whenever they liked.
 */
async function connectIdentity(
  internals: AuthInternals,
  input: CallbackProviderInput,
  resolved: ResolvedSession | null,
  expectedUserId: string | undefined,
  identity: ProviderIdentity,
  clearState: string,
  redirect: string
) {
  if (!resolved || !expectedUserId || resolved.user.id !== expectedUserId) {
    throw unauthenticated()
  }

  const existing = await selectOne(internals, "identities", {
    provider: { eq: input.provider },
    providerUserId: { eq: identity.providerUserId }
  })

  // Never re-point an existing link: that would move someone else's provider
  // identity onto this account.
  if (existing && existing.userId !== resolved.user.id) {
    throw new AuthApiError("providerConflict", 409)
  }

  await linkIdentity(internals, {
    userId: resolved.user.id,
    provider: input.provider,
    providerUserId: identity.providerUserId,
    ...(identity.label ? { label: identity.label } : {}),
    ...(identity.tokens ? { tokens: identity.tokens } : {})
  })

  const headers = new Headers({ location: redirect })
  headers.append("set-cookie", clearState)

  // No session is issued: the user was already signed in, and connect never
  // creates a user.
  return { data: undefined, status: 302, headers }
}

function errorRedirect(
  code: AuthErrorCode,
  clearState: string,
  redirect: string
) {
  // Parsed against a base so an existing query survives. A path stays a path;
  // `baseURL` is absolute and travels whole.
  const target = new URL(redirect, "http://redirect.invalid")
  target.searchParams.set("error", code)

  const headers = new Headers({
    location: redirect.startsWith("/")
      ? `${target.pathname}${target.search}${target.hash}`
      : target.href
  })
  headers.append("set-cookie", clearState)

  return { data: undefined, status: 302, headers }
}
