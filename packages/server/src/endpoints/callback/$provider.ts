import { notFound } from "../../http/auth-api-error.ts"
import { defineEndpoint } from "../../http/define-endpoint.ts"
import type { AuthErrorCode } from "../../http/error-response.ts"
import { getErrorMessage } from "../../http/get-error-message.ts"
import { shouldUseSecureCookies } from "../../lib/serialize-cookie.ts"
import { getProvider } from "../../oauth/providers/get-provider.ts"
import type { ProviderIdentity } from "../../oauth/providers/oauth-provider.ts"
import { resolveOAuthUser } from "../../oauth/resolve-oauth-user.ts"
import { clearStateCookie, readStateCookie } from "../../oauth/state-cookie.ts"
import { convertGuest } from "../../session/convert-guest.ts"
import { issueSession } from "../../session/issue-session.ts"
import { resolveSession } from "../../session/resolve-session.ts"

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

/**
 * Finishes an OAuth flow, for both sign-in and linking.
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
    const { options } = internals
    const configured = getProvider(options.providers, input.provider)
    if (!configured || !options.baseURL) throw notFound()

    const secure = shouldUseSecureCookies(input.requestURL)
    const clearState = clearStateCookie(internals, input.provider, secure)

    // Verified before anything else is trusted, and the cookie is cleared
    // whichever way this goes so a state value is never replayable.
    const payload = readStateCookie(internals, input.headers, input.state)
    const locale = payload.locale ?? options.localization?.defaultLocale ?? "en"

    if (input.providerError || !input.code) {
      return errorPage(internals, "unauthenticated", locale, clearState)
    }

    const identity = await configured.provider.exchangeCode({
      credentials: configured.credentials,
      redirectURI: `${options.baseURL}${options.basePath}/callback/${input.provider}`,
      code: input.code
    })

    if (payload.intent === "connect") {
      return connectIdentity(
        internals,
        input,
        payload.userId,
        identity,
        locale,
        clearState,
        payload.redirect
      )
    }

    const active = await resolveSession(internals, input.headers)
    const user =
      active?.user.type === "guest" && identity.email
        ? (
            await convertGuest(internals, active.user, {
              email: identity.email,
              ...(identity.name ? { name: identity.name } : {}),
              ...(identity.imageURL ? { imageURL: identity.imageURL } : {})
            })
          ).user
        : await resolveOAuthUser(
            internals,
            input.provider,
            identity,
            payload.additionalFields ?? {}
          )

    // A guest converting through OAuth still needs the connection recorded, or
    // their next sign-in would not find them by provider id.
    if (active?.user.type === "guest") {
      await internals.db.upsertConnection({
        userId: user.id,
        provider: input.provider,
        providerAccountId: identity.providerAccountId,
        ...(identity.email ? { email: identity.email } : {})
      })
    }

    const issued = await issueSession(internals, {
      user,
      headers: input.headers,
      requestURL: input.requestURL
    })

    const headers = new Headers(issued.headers)
    headers.append("set-cookie", clearState)
    headers.set("location", payload.redirect)

    return { data: undefined, status: 302, headers }
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
  internals: AuthServerInternalsAlias,
  input: CallbackProviderInput,
  expectedUserId: string | undefined,
  identity: ProviderIdentity,
  locale: string,
  clearState: string,
  redirect: string
) {
  const resolved = await resolveSession(internals, input.headers)
  if (!resolved || !expectedUserId || resolved.user.id !== expectedUserId) {
    return errorPage(internals, "unauthenticated", locale, clearState)
  }

  const existing = await internals.db.getConnection({
    provider: input.provider,
    providerAccountId: identity.providerAccountId
  })

  // Never re-point an existing link: that would move someone else's provider
  // identity onto this account.
  if (existing && existing.userId !== resolved.user.id) {
    return errorPage(internals, "providerConflict", locale, clearState, 409)
  }

  await internals.db.upsertConnection({
    userId: resolved.user.id,
    provider: input.provider,
    providerAccountId: identity.providerAccountId,
    ...(identity.email ? { email: identity.email } : {})
  })

  const headers = new Headers({ location: redirect })
  headers.append("set-cookie", clearState)

  // No session is issued: the user was already signed in, and connect never
  // creates a user.
  return { data: undefined, status: 302, headers }
}

/**
 * Renders a human-readable failure.
 *
 * A callback is a top-level navigation, so the person is looking at whatever it
 * returns — a JSON envelope would be a wall of braces. The message is the same
 * localized string the API would have returned.
 */
function errorPage(
  internals: AuthServerInternalsAlias,
  code: AuthErrorCode,
  locale: string,
  clearState: string,
  status = 401
) {
  const message = getErrorMessage(code, locale, internals.options.localization)
  const headers = new Headers({ "content-type": "text/html; charset=utf-8" })
  headers.append("set-cookie", clearState)

  const escaped = message.replace(/[<>&]/g, (character) =>
    character === "<" ? "&lt;" : character === ">" ? "&gt;" : "&amp;"
  )

  return {
    data: undefined,
    status,
    headers,
    body: `<!doctype html><meta charset="utf-8"><title>Sign-in failed</title><p>${escaped}</p>`
  }
}

type AuthServerInternalsAlias =
  import("../../core/auth-server-internals.ts").AuthServerInternals
