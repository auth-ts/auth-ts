import { AuthApiError, unauthenticated } from "../../http/auth-api-error"
import { defineEndpoint } from "../../http/define-endpoint"
import { resolveLocale } from "../../http/resolve-locale"
import { selectOne } from "../../lib/select-one"
import type { EndpointDocs } from "../../openapi/endpoint-docs"
import type { CallerInput } from "../../session/authenticate"
import { authenticate } from "../../session/authenticate"
import { sendVerificationCode } from "../../verification-code/send-verification-code"

/** How `POST /user/send-delete-code` appears in the OpenAPI document. */
export const sendDeleteUserCodeDocs: EndpointDocs<CallerInput> = {
  description:
    "Sent to whichever address is already on the account. There is nothing to choose, so there is nothing to post.",
  tag: "User",
  auth: "bearer",
  responses: {
    200: {
      description: "Accepted for delivery.",
      schema: {
        type: "object",
        properties: { sent: { type: "boolean" } },
        required: ["sent"]
      }
    },
    401: "Unauthenticated",
    409: "GuestCannotReceiveCode",
    429: "RateLimited"
  }
}

/**
 * Send a delete-user code.
 *
 * The one call that puts a code in flight for `DELETE /user`. Kept apart from
 * the delete itself so retrying a failed delete can never resend one — a delete
 * refuses or succeeds, and only this endpoint has the side effect.
 */
export const sendDeleteUserCode = defineEndpoint({
  method: "POST",
  path: "/user/send-delete-code",
  parse: ({ request }): CallerInput => ({ headers: request.headers }),
  run: async (internals, input: CallerInput) => {
    const headers = input.headers ?? new Headers()
    const caller = await authenticate(internals, input)
    const user = await selectOne(internals, "users", { id: caller.userId })
    // Core deletes a user's sessions before the user, so a token naming one
    // that is gone means a delete failed part-way. Refuse it rather than trust
    // it.
    if (!user) throw unauthenticated()

    const identifier = user.email
      ? ({ kind: "email", value: user.email } as const)
      : user.phoneNumber
        ? ({ kind: "phoneNumber", value: user.phoneNumber } as const)
        : null

    if (!identifier) throw new AuthApiError("guestCannotReceiveCode", 409)

    await sendVerificationCode(internals, {
      identifier,
      purpose: "deleteUser",
      locale: resolveLocale(
        headers.get("accept-language"),
        internals.config.localization
      ),
      headers
    })

    return { data: { sent: true } }
  }
})
