import { defineEndpoint } from "../../http/define-endpoint"
import { readBody } from "../../http/read-body"
import { resolveLocale } from "../../http/resolve-locale"
import type { EndpointDocs } from "../../openapi/endpoint-docs"
import { attemptCookie } from "../../shared/attempt-cookie"
import type { IdentifierBody } from "../../verification-code/resolve-code-identifier"
import { resolveCodeIdentifier } from "../../verification-code/resolve-code-identifier"
import { sendVerificationCode } from "../../verification-code/send-verification-code"

/** Body accepted by `POST /sign-in/send-code`: exactly one identifier. */
export interface SendSignInCodeInput extends IdentifierBody {
  /** Request headers, filled in from the request when over HTTP. */
  headers?: Headers
  requestURL?: string
}

/** How `POST /sign-in/send-code` appears in the OpenAPI document. */
export const sendSignInCodeDocs: EndpointDocs<SendSignInCodeInput> = {
  description: "Send either an email or a phone number, not both.",
  tag: "Sign in",
  auth: "none",
  body: {
    type: "object",
    properties: {
      email: {
        type: "string",
        format: "email",
        description:
          "Lowercase; letters, digits and . _ + - before one @, a dotted domain after; at most 100 characters. Taken as sent, never modified."
      },
      phoneNumber: {
        type: "string",
        description: "E.164, e.g. `+15551234567`."
      }
    }
  },
  responses: {
    200: {
      description:
        "Accepted for delivery. The code can only be verified by the client that requested it: browsers carry the attempt cookie, other callers present `attempt`.",
      setsCookie: "attempt",
      schema: {
        type: "object",
        properties: {
          sent: { type: "boolean" },
          attempt: {
            type: "string",
            description:
              "Present it as `attempt` on `/sign-in/code` when no cookie jar carries it."
          }
        },
        required: ["sent", "attempt"]
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
    const body = await readBody<IdentifierBody>(request, [
      "email",
      "phoneNumber"
    ])

    return { ...body, headers: request.headers, requestURL: request.url }
  },
  run: async (internals, input: SendSignInCodeInput) => {
    const identifier = resolveCodeIdentifier(internals, input)
    const headers = input.headers ?? new Headers()

    const attempt = await sendVerificationCode(internals, {
      deliverTo: identifier,
      key: identifier.value,
      purpose: "signIn",
      limit: { key: `send:${identifier.value}`, bucket: "sends" },
      locale: resolveLocale(
        headers.get("accept-language"),
        internals.config.localization
      ),
      headers
    })

    return {
      data: { sent: true, attempt },
      headers: new Headers({
        "set-cookie": attemptCookie(
          internals,
          "signIn",
          attempt,
          input.requestURL
        )
      })
    }
  }
})
