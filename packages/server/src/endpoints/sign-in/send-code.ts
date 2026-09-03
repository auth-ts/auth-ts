import { defineEndpoint } from "../../http/define-endpoint"
import { resolveLocale } from "../../http/resolve-locale"
import type { EndpointDocs } from "../../openapi/endpoint-docs"
import type { IdentifierBody } from "../../verification-code/resolve-code-identifier"
import { resolveCodeIdentifier } from "../../verification-code/resolve-code-identifier"
import { sendVerificationCode } from "../../verification-code/send-verification-code"

/** Body accepted by `POST /sign-in/send-code`: exactly one identifier. */
export interface SendSignInCodeInput extends IdentifierBody {
  /** Request headers, filled in from the request when over HTTP. */
  headers?: Headers
}

/** How `POST /sign-in/send-code` appears in the OpenAPI document. */
export const sendSignInCodeDocs: EndpointDocs<SendSignInCodeInput> = {
  description: "Send either an email or a phone number, not both.",
  tag: "Sign in",
  auth: "none",
  body: {
    type: "object",
    properties: {
      email: { type: "string", format: "email" },
      phoneNumber: {
        type: "string",
        description: "E.164, e.g. `+15551234567`."
      }
    }
  },
  responses: {
    200: {
      description: "Accepted for delivery.",
      schema: {
        type: "object",
        properties: { sent: { type: "boolean" } },
        required: ["sent"]
      }
    },
    400: "InvalidField",
    429: "RateLimited"
  }
}

/**
 * Send a sign in code.
 *
 * Always answers 200, even for an address that has never been seen. The user is
 * created when the code is verified, not here, so there is genuinely nothing to
 * enumerate — a different status for unknown addresses would turn this endpoint
 * into a "does this person have an account" oracle.
 */
export const sendSignInCode = defineEndpoint({
  method: "POST",
  path: "/sign-in/send-code",
  parse: async ({ request }): Promise<SendSignInCodeInput> => {
    const body = (await request.json().catch(() => ({}))) as IdentifierBody

    return { ...body, headers: request.headers }
  },
  run: async (internals, input: SendSignInCodeInput) => {
    const identifier = resolveCodeIdentifier(internals, input)
    const headers = input.headers ?? new Headers()

    await sendVerificationCode(internals, {
      identifier,
      purpose: "signIn",
      locale: resolveLocale(
        headers.get("accept-language"),
        internals.config.localization
      ),
      headers
    })

    return { data: { sent: true } }
  }
})
