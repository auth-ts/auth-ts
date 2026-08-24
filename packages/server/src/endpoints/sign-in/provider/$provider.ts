import { notFound } from "../../../http/auth-api-error"
import { defineEndpoint } from "../../../http/define-endpoint"
import { resolveLocale } from "../../../http/resolve-locale"
import { validateAdditionalFields } from "../../../http/validate-additional-fields"
import { shouldUseSecureCookies } from "../../../lib/serialize-cookie"
import { validateRedirect } from "../../../lib/validate-redirect"
import { getCallbackURL } from "../../../oauth/callback-url"
import { getProvider } from "../../../oauth/providers/get-provider"
import { createStateCookie } from "../../../oauth/state-cookie"
import type { EndpointDocs } from "../../../openapi/endpoint-docs"

/** Input for starting an OAuth sign-in. */
export interface SignInProviderInput {
  provider: string
  /** Same-origin path to return to; anything else falls back to `/`. */
  redirect?: string
  locale?: string
  additionalFields?: Record<string, unknown>
  headers?: Headers
  requestURL?: string
}

/** Where to send the browser, and the cookie that has to travel with it. */
export interface AuthorizeURLResult {
  url: string
}

/** How `POST /sign-in/provider/$provider` appears in the OpenAPI document. */
export const signInWithProviderDocs: EndpointDocs<
  SignInProviderInput,
  "provider"
> = {
  description: "Navigate to the url. Do not fetch it.",
  tag: "Sign in",
  auth: "none",
  requires: "providers",
  additionalFields: "nested",
  params: {
    provider: "The provider to sign in with. Must be one you configured."
  },
  body: {
    type: "object",
    properties: {
      redirect: {
        type: "string",
        description:
          "Same-origin path to return to; anything else falls back to `/`."
      },
      locale: {
        type: "string",
        description:
          "Overrides the locale otherwise resolved from `Accept-Language`."
      }
    }
  },
  responses: {
    200: {
      description: "The authorize URL to navigate to.",
      setsCookie: "state",
      schema: "AuthorizeURL"
    },
    400: "InvalidField",
    404: "NotFound"
  }
}

/**
 * Sign in with a provider.
 *
 * A POST that answers with the URL rather than a redirect, because the caller
 * has to be the one that navigates. A desktop or mobile app must open the
 * system browser rather than its own webview — RFC 8252, and Google refuses an
 * embedded one outright — and it cannot read a `Location` header out of a 302,
 * since a manual-redirect fetch response is opaque. Handing over the URL is the
 * only shape that serves both a browser and a native shell.
 *
 * The route is generic over the provider so that adding one stays configuration
 * rather than a new endpoint.
 *
 * Signing in while already signed in never links accounts — it either appends
 * another account or replaces the current one, depending on `multiAccount`.
 * Linking is what `/identities/connect` is for, and the two are kept apart by the `intent`
 * recorded in the state cookie. Anything else would mean a stray sign-in silently
 * attaching a provider to whoever happened to be logged in.
 */
export const signInWithProvider = defineEndpoint({
  method: "POST",
  path: "/sign-in/provider/$provider",
  parse: async ({
    request,
    params,
    internals
  }): Promise<SignInProviderInput> => {
    const body = (await request.json().catch(() => ({}))) as Omit<
      SignInProviderInput,
      "provider"
    >

    return {
      ...body,
      provider: params.provider ?? "",
      locale:
        body.locale ??
        resolveLocale(
          request.headers.get("accept-language"),
          internals.config.localization
        ),
      headers: request.headers,
      requestURL: request.url
    }
  },
  run: async (internals, input: SignInProviderInput) => {
    const { config } = internals
    const configured = getProvider(config.providers, input.provider)
    if (!configured) throw notFound()

    const additionalFields = validateAdditionalFields(
      config.user.additionalFields,
      input.additionalFields
    )
    const secure = shouldUseSecureCookies(input.requestURL)
    const redirectURI = getCallbackURL(
      config,
      input.provider,
      input.requestURL,
      input.headers
    )

    const { state, codeChallenge, nonce, setCookie } = await createStateCookie(
      internals,
      input.provider,
      {
        intent: "signIn",
        redirect: validateRedirect(input.redirect),
        ...(input.locale ? { locale: input.locale } : {}),
        ...(Object.keys(additionalFields).length > 0
          ? { additionalFields }
          : {})
      },
      secure
    )

    const headers = new Headers()
    headers.append("set-cookie", setCookie)

    const data: AuthorizeURLResult = {
      url: configured.provider.authorizeURL({
        credentials: configured.credentials,
        redirectURI,
        state,
        codeChallenge,
        nonce
      })
    }

    return { data, headers }
  }
})
