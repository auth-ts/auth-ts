import { AuthApiError, notFound } from "../../http/auth-api-error.ts"
import { defineEndpoint } from "../../http/define-endpoint.ts"
import { shouldUseSecureCookies } from "../../lib/serialize-cookie.ts"
import { validateRedirect } from "../../lib/validate-redirect.ts"
import { getProvider } from "../../oauth/providers/get-provider.ts"
import { createStateCookie } from "../../oauth/state-cookie.ts"
import { resolveSession } from "../../session/resolve-session.ts"
import type { SignInProviderInput } from "../sign-in/$provider.ts"

/** Input for starting a provider link. */
export interface ConnectProviderInput extends SignInProviderInput {}

/**
 * Starts linking a provider to the **current** user.
 *
 * Requires a session up front, and records that user's id in the state so the
 * callback can insist the same person is still signed in when they come back.
 *
 * For a guest this is a sign-in wearing a different URL: there is no account to
 * link to yet, so the callback upgrades or merges them exactly as
 * `/sign-in/:provider` would.
 */
export const connectProvider = defineEndpoint({
  method: "GET",
  path: "/connect/$provider",
  parse: ({ request, params }): ConnectProviderInput => {
    const url = new URL(request.url)

    return {
      provider: params.provider ?? "",
      redirect: url.searchParams.get("redirect") ?? undefined,
      locale: url.searchParams.get("locale") ?? undefined,
      headers: request.headers,
      requestURL: request.url
    }
  },
  run: async (internals, input: ConnectProviderInput) => {
    const { config } = internals
    const headers = input.headers ?? new Headers()

    const resolved = await resolveSession(internals, headers)
    if (!resolved) throw new AuthApiError("unauthenticated", 401)

    const configured = getProvider(config.providers, input.provider)
    if (!configured || !config.baseURL) throw notFound()

    const secure = shouldUseSecureCookies(
      input.requestURL ?? "https://localhost"
    )
    const redirectURI = `${config.baseURL}${config.basePath}/callback/${input.provider}`

    const { state, codeChallenge, nonce, setCookie } = await createStateCookie(
      internals,
      input.provider,
      {
        intent: "connect",
        redirect: validateRedirect(input.redirect),
        userId: resolved.user.id,
        ...(input.locale ? { locale: input.locale } : {})
      },
      secure
    )

    const responseHeaders = new Headers({
      location: configured.provider.authorizeURL({
        credentials: configured.credentials,
        redirectURI,
        state,
        codeChallenge,
        nonce
      })
    })
    responseHeaders.append("set-cookie", setCookie)

    return { data: undefined, status: 302, headers: responseHeaders }
  }
})
