import { notFound } from "../../http/auth-api-error"
import { defineEndpoint } from "../../http/define-endpoint"
import { shouldUseSecureCookies } from "../../lib/serialize-cookie"
import { validateRedirect } from "../../lib/validate-redirect"
import { getCallbackURL } from "../../oauth/callback-url"
import { getProvider } from "../../oauth/providers/get-provider"
import { createStateCookie } from "../../oauth/state-cookie"
import type { CallerInput } from "../../session/authenticate"
import { authenticate } from "../../session/authenticate"
import type {
  AuthorizeURLResult,
  SignInProviderInput
} from "../sign-in/provider/$provider"

/** Input for starting a provider link. */
export interface ConnectProviderInput
  extends SignInProviderInput,
    CallerInput {}

/**
 * Starts linking a provider to the **current** user.
 *
 * Answers with the authorize URL rather than a redirect, for the reason
 * `/sign-in/provider/:provider` does — and because it is a POST it
 * authenticates from the access token like every other authenticated endpoint.
 * As a navigation it could not: a top-level `location.assign` carries no
 * `Authorization` header, so this route was the one place a cookie was still a
 * credential.
 *
 * Requires a session up front, and records that user's id in the state so the
 * callback can insist the same person is still signed in when they come back.
 *
 * For a guest this is a sign-in wearing a different URL: there is no account to
 * link to yet, so the callback upgrades or merges them exactly as
 * `/sign-in/provider/:provider` would.
 */
export const connectProvider = defineEndpoint({
  method: "POST",
  path: "/connect/$provider",
  parse: async ({ request, params }): Promise<ConnectProviderInput> => {
    const body = (await request.json().catch(() => ({}))) as Omit<
      ConnectProviderInput,
      "provider"
    >

    return {
      ...body,
      provider: params.provider ?? "",
      headers: request.headers,
      requestURL: request.url
    }
  },
  run: async (internals, input: ConnectProviderInput) => {
    const { config } = internals
    const headers = input.headers ?? new Headers()

    const caller = await authenticate(internals, input)

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
        userId: caller.userId,
        ...(input.locale ? { locale: input.locale } : {})
      },
      secure
    )

    const responseHeaders = new Headers()
    responseHeaders.append("set-cookie", setCookie)

    const data: AuthorizeURLResult = {
      url: configured.provider.authorizeURL({
        credentials: configured.credentials,
        redirectURI,
        state,
        codeChallenge,
        nonce
      })
    }

    return { data, headers: responseHeaders }
  }
})
