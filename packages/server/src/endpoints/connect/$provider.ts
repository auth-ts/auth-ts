import { notFound, unauthenticated } from "../../http/auth-api-error"
import { defineEndpoint } from "../../http/define-endpoint"
import { shouldUseSecureCookies } from "../../lib/serialize-cookie"
import { validateRedirect } from "../../lib/validate-redirect"
import { getCallbackURL } from "../../oauth/callback-url"
import { getProvider } from "../../oauth/providers/get-provider"
import { createStateCookie } from "../../oauth/state-cookie"
import type { CallerInput } from "../../session/authenticate"
import { resolveCallerSession } from "../../session/resolve-session"
import type { SignInProviderInput } from "../sign-in/$provider"

/** Input for starting a provider link. */
export interface ConnectProviderInput
  extends SignInProviderInput,
    CallerInput {}

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

    // A top-level navigation, so there is no `Authorization` header to read
    // and the cookie is the credential that actually arrives.
    const caller = await resolveCallerSession(internals, input)
    if (!caller) throw unauthenticated()

    const configured = getProvider(config.providers, input.provider)
    if (!configured) throw notFound()

    const secure = shouldUseSecureCookies(input.requestURL)
    const redirectURI = getCallbackURL(
      config,
      input.provider,
      input.requestURL,
      headers
    )

    const { state, codeChallenge, nonce, setCookie } = await createStateCookie(
      internals,
      input.provider,
      {
        intent: "connect",
        redirect: validateRedirect(input.redirect),
        userId: caller.user.id,
        ...(input.locale ? { locale: input.locale } : {})
      },
      secure
    )

    const responseHeaders = new Headers()
    responseHeaders.set(
      "location",
      configured.provider.authorizeURL({
        credentials: configured.credentials,
        redirectURI,
        state,
        codeChallenge,
        nonce
      })
    )
    responseHeaders.append("set-cookie", setCookie)

    return { data: undefined, status: 302, headers: responseHeaders }
  }
})
