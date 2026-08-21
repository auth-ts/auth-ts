import { isAuthApiError, notFound } from "../../http/auth-api-error.ts"
import { defineEndpoint } from "../../http/define-endpoint.ts"
import type { AuthErrorCode } from "../../http/error-response.ts"
import { getErrorMessage } from "../../http/get-error-message.ts"
import { shouldUseSecureCookies } from "../../lib/serialize-cookie.ts"
import { getProvider } from "../../oauth/providers/get-provider.ts"
import type { ProviderIdentity } from "../../oauth/providers/oauth-provider.ts"
import { resolveOAuthUser } from "../../oauth/resolve-oauth-user.ts"
import { clearStateCookie, readStateCookie } from "../../oauth/state-cookie.ts"
import { issueSession } from "../../session/issue-session.ts"
import { resolveSession } from "../../session/resolve-session.ts"

/**
 * How long the provider gets to answer the whole code exchange.
 *
 * Generous next to the sub-second responses GitHub and Google normally give, but
 * bounded: without it a stalled provider holds the callback request open for as
 * long as the platform allows, and a burst of those is a sign-in outage.
 */
const PROVIDER_DEADLINE_MS = 10_000

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

    let identity: ProviderIdentity
    try {
      identity = await configured.provider.exchangeCode({
        credentials: configured.credentials,
        redirectURI: `${options.baseURL}${options.basePath}/callback/${input.provider}`,
        code: input.code,
        signal: AbortSignal.timeout(PROVIDER_DEADLINE_MS)
      })
    } catch (error) {
      // Still a top-level navigation, so a provider failure is a page, not a
      // JSON envelope. A rejected code is the provider's verdict; anything else
      // — the deadline, a DNS failure — is the provider being unreachable.
      if (isAuthApiError(error)) {
        return errorPage(
          internals,
          error.code,
          locale,
          clearState,
          error.status
        )
      }
      internals.log.error("oauth provider request failed", {
        provider: input.provider,
        error: String(error)
      })
      return errorPage(
        internals,
        "providerUnavailable",
        locale,
        clearState,
        502
      )
    }

    const active = await resolveSession(internals, input.headers)

    // Linking only means linking for a real user. A guest who "connects" a
    // provider is really signing in: the identity decides whether they upgrade
    // in place or merge into the account it already belongs to, and they get a
    // session for the result — exactly what `/sign-in/:provider` would do.
    if (payload.intent === "connect" && active?.user.type !== "guest") {
      return connectIdentity(
        internals,
        input,
        active,
        payload.userId,
        identity,
        locale,
        clearState,
        payload.redirect
      )
    }

    // A signed-in guest converts rather than creating a new user. The lookup
    // lives inside resolveOAuthUser so the guest path runs the same
    // connection-first cascade as everyone else — a provider account already
    // linked to an account is never silently re-pointed at the guest.
    const user = await resolveOAuthUser(internals, input.provider, identity, {
      additionalFields: payload.additionalFields ?? {},
      ...(active?.user.type === "guest" ? { guest: active.user } : {})
    })

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
  resolved: Awaited<ReturnType<typeof resolveSession>>,
  expectedUserId: string | undefined,
  identity: ProviderIdentity,
  locale: string,
  clearState: string,
  redirect: string
) {
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
