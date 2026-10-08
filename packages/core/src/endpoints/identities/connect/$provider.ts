import { notFound } from "../../../http/auth-api-error"
import { defineEndpoint } from "../../../http/define-endpoint"
import { readBody } from "../../../http/read-body"
import { getProvider } from "../../../oauth/providers/get-provider"
import { startProviderFlow } from "../../../oauth/start-provider-flow"
import type { EndpointDocs } from "../../../openapi/endpoint-docs"
import type { CallerInput } from "../../../session/authenticate"
import { authenticate } from "../../../session/authenticate"
import type { SignInWithProviderInput } from "../../sign-in/provider/$provider"

/** Input for connecting a provider. */
export interface ConnectProviderInput
  extends SignInWithProviderInput,
    CallerInput {}

/** How `POST /identities/connect/$provider` appears in the OpenAPI document. */
export const connectProviderDocs: EndpointDocs<
  ConnectProviderInput,
  "provider"
> = {
  description:
    "Connects to the current user, unlike sign-in. Navigate to the url.",
  tag: "Identities",
  auth: "bearer",
  params: { provider: "The provider to link. Must be one you configured." },
  body: {
    type: "object",
    properties: {
      redirect: {
        type: "string",
        description:
          "Same-origin path to return to; anything else falls back to `/`."
      },
      errorRedirect: {
        type: "string",
        description:
          "Same-origin path a failed flow returns to, with the code in `?error=`. Falls back to `baseURL`."
      }
    }
  },
  responses: {
    200: {
      description: "The authorize URL to navigate to.",
      setsCookie: "state",
      schema: "AuthorizeURL"
    },
    401: "Unauthenticated",
    404: "NotFound",
    409: "Conflict"
  }
}

/**
 * Connect a provider.
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
  path: "/identities/connect/$provider",
  requires: "providers",
  parse: async ({ request, params }): Promise<ConnectProviderInput> => {
    const body = await readBody<Omit<ConnectProviderInput, "provider">>(
      request,
      ["redirect", "errorRedirect"]
    )

    return {
      ...body,
      provider: params.provider ?? "",
      headers: request.headers,
      requestURL: request.url
    }
  },
  run: async (internals, input: ConnectProviderInput) => {
    const caller = await authenticate(internals, input)
    const configured = getProvider(internals.config.providers, input.provider)
    if (!configured) throw notFound()

    return startProviderFlow(internals, configured, input, {
      intent: "connect",
      userId: caller.userId
    })
  }
})
