import { notFound } from "../../http/auth-api-error.ts"
import { defineEndpoint } from "../../http/define-endpoint.ts"
import { resolveLocale } from "../../http/resolve-locale.ts"
import { validateAdditionalFields } from "../../http/validate-additional-fields.ts"
import { shouldUseSecureCookies } from "../../lib/serialize-cookie.ts"
import { validateRedirect } from "../../lib/validate-redirect.ts"
import { getProvider } from "../../oauth/providers/get-provider.ts"
import { createStateCookie } from "../../oauth/state-cookie.ts"

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

/**
 * Starts an OAuth sign-in.
 *
 * The route is generic over the provider so that adding one stays configuration
 * rather than a new endpoint.
 *
 * Signing in while already signed in never links accounts — it either appends
 * another account or replaces the current one, depending on `multiAccount`.
 * Linking is what `/connect` is for, and the two are kept apart by the `intent`
 * recorded in the state cookie. Anything else would mean a stray sign-in silently
 * attaching a provider to whoever happened to be logged in.
 */
export const signInProvider = defineEndpoint({
  method: "GET",
  path: "/sign-in/$provider",
  parse: ({ request, params, internals }): SignInProviderInput => {
    const url = new URL(request.url)
    const rawFields = url.searchParams.get("additionalFields")

    return {
      provider: params.provider ?? "",
      redirect: url.searchParams.get("redirect") ?? undefined,
      locale:
        url.searchParams.get("locale") ??
        resolveLocale(
          request.headers.get("accept-language"),
          internals.options.localization
        ),
      additionalFields: rawFields
        ? (JSON.parse(rawFields) as Record<string, unknown>)
        : undefined,
      headers: request.headers,
      requestURL: request.url
    }
  },
  run: async (internals, input: SignInProviderInput) => {
    const { options } = internals
    const configured = getProvider(options.providers, input.provider)
    if (!configured || !options.baseURL) throw notFound()

    const additionalFields = validateAdditionalFields(
      options.user.additionalFields,
      input.additionalFields
    )
    const secure = shouldUseSecureCookies(
      input.requestURL ?? "https://localhost"
    )
    const redirectURI = `${options.baseURL}${options.basePath}/callback/${input.provider}`

    const { state, setCookie } = await createStateCookie(
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

    const headers = new Headers({
      location: configured.provider.authorizeURL({
        credentials: configured.credentials,
        redirectURI,
        state
      })
    })
    headers.append("set-cookie", setCookie)

    return { data: undefined, status: 302, headers }
  }
})
