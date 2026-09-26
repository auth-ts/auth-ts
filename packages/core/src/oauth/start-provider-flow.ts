import type { AuthInternals } from "../core/auth-internals"
import type { AuthorizeURLResult } from "../endpoints/sign-in/provider/$provider"
import { shouldUseSecureCookies } from "../lib/serialize-cookie"
import { validateRedirect } from "../lib/validate-redirect"
import { getCallbackURL } from "./callback-url"
import type { getProvider } from "./providers/get-provider"
import type { OAuthStatePayload } from "./state-cookie"
import { createStateCookie } from "./state-cookie"

/** What a flow starts from, beyond the checks its endpoint makes first. */
export interface StartProviderFlowInput {
  provider: string
  redirect?: string
  errorRedirect?: string
  headers?: Headers
  requestURL?: string
}

/**
 * Writes the state cookie and answers with the provider's authorize URL.
 *
 * Shared by sign-in and connect, which differ only in what the state records.
 * The caller resolves the provider and authenticates first, so each endpoint
 * keeps its own order of refusals.
 */
export async function startProviderFlow(
  internals: AuthInternals,
  configured: NonNullable<ReturnType<typeof getProvider>>,
  input: StartProviderFlowInput,
  payload: Pick<OAuthStatePayload, "intent" | "additionalFields" | "userId">
) {
  const secure = shouldUseSecureCookies(input.requestURL)
  const redirectURI = getCallbackURL(
    internals.config,
    input.provider,
    input.requestURL,
    input.headers
  )

  const { state, codeChallenge, nonce, setCookie } = await createStateCookie(
    internals,
    input.provider,
    {
      ...payload,
      redirect: validateRedirect(input.redirect),
      ...(input.errorRedirect
        ? { errorRedirect: validateRedirect(input.errorRedirect) }
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
