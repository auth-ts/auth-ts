import { AuthApiError, unauthenticated } from "../../http/auth-api-error"
import { defineEndpoint } from "../../http/define-endpoint"
import { readBody } from "../../http/read-body"
import { resolveLocale } from "../../http/resolve-locale"
import { selectOne } from "../../lib/select-one"
import type { EndpointDocs } from "../../openapi/endpoint-docs"
import type { CallerInput } from "../../session/authenticate"
import { authenticate } from "../../session/authenticate"
import { sessionAge } from "../../session/session-token"
import type { AttemptInput } from "../../shared/attempt-cookie"
import { attemptCookie, readAttempt } from "../../shared/attempt-cookie"
import { markIdentityVerified } from "../../verification-code/identity"
import { accountIdentifier } from "../../verification-code/resolve-code-identifier"
import { sendVerificationCode } from "../../verification-code/send-verification-code"

/** What `POST /user/verify/send-code` is called with. */
export interface SendIdentityCodeInput extends CallerInput {
  requestURL?: string
}

/** How `POST /user/verify/send-code` appears in the OpenAPI document. */
export const sendIdentityCodeDocs: EndpointDocs<SendIdentityCodeInput> = {
  description:
    "Sent to whichever address is already on the account. There is nothing to choose, so there is nothing to post.",
  tag: "User",
  auth: "bearer",
  responses: {
    200: {
      description:
        "Accepted for delivery. Browsers carry the attempt cookie to `/user/verify`; other callers present `attempt`.",
      setsCookie: "attempt",
      schema: {
        type: "object",
        properties: {
          sent: { type: "boolean" },
          attempt: { type: "string" }
        },
        required: ["sent", "attempt"]
      }
    },
    401: "Unauthenticated",
    409: "GuestCannotReceiveCode",
    429: "RateLimited"
  }
}

/**
 * Send an identity code.
 *
 * The first half of "confirm it's you". The code is filed under the session
 * that asked, so no other session of the same user can redeem it, and bound
 * to this browser by the attempt cookie.
 */
export const sendIdentityCode = defineEndpoint({
  method: "POST",
  path: "/user/verify/send-code",
  parse: ({ request }): SendIdentityCodeInput => ({
    headers: request.headers,
    requestURL: request.url
  }),
  run: async (internals, input: SendIdentityCodeInput) => {
    const headers = input.headers ?? new Headers()
    const caller = await authenticate(internals, input)
    const [user, session] = await Promise.all([
      selectOne(internals, "users", { id: { eq: caller.userId } }),
      selectOne(internals, "sessions", {
        id: { eq: caller.sessionId },
        ...sessionAge(internals).live
      })
    ])
    // A session revoked since the token was minted refuses too, or a
    // signed-out token would keep putting codes in flight.
    if (!user || !session) throw unauthenticated()

    const identifier = accountIdentifier(user)
    if (!identifier) throw new AuthApiError("guestCannotReceiveCode")

    const attempt = await sendVerificationCode(internals, {
      deliverTo: identifier,
      key: caller.sessionId,
      purpose: "identity",
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
          "identity",
          attempt,
          input.requestURL
        )
      })
    }
  }
})

/** Body accepted by `POST /user/verify`. */
export interface VerifyIdentityInput extends CallerInput, AttemptInput {
  code: string
  requestURL?: string
}

/** How `POST /user/verify` appears in the OpenAPI document. */
export const verifyIdentityDocs: EndpointDocs<VerifyIdentityInput> = {
  description:
    "Lets this session, in this browser, revoke devices and delete the account for the next hour.",
  tag: "User",
  auth: "bearer",
  body: {
    type: "object",
    properties: {
      code: { type: "string" },
      attempt: {
        type: "string",
        description:
          "The token `/user/verify/send-code` returned. Browsers send it as a cookie instead."
      }
    },
    required: ["code"]
  },
  responses: {
    204: { description: "Verified.", setsCookie: "attempt" },
    401: {
      description: "The code is wrong, expired, or already used.",
      schema: "AuthError"
    },
    429: "RateLimited"
  }
}

/**
 * Verify identity.
 *
 * The second half of "confirm it's you". What it leaves behind is the marker
 * `DELETE /sessions/$id` and `DELETE /user` check: bound to this session and
 * this browser, good for an hour, and not spent by the actions it allows.
 */
export const verifyIdentity = defineEndpoint({
  method: "POST",
  path: "/user/verify",
  parse: async ({ request }): Promise<VerifyIdentityInput> => {
    const body = await readBody<{ code: string; attempt?: string }>(request, [
      "code",
      "attempt"
    ])

    return { ...body, headers: request.headers, requestURL: request.url }
  },
  run: async (internals, input: VerifyIdentityInput) => {
    const caller = await authenticate(internals, input)
    if (typeof input.code !== "string" || input.code.length === 0) {
      throw new AuthApiError("invalidField", {
        message: "A code is required."
      })
    }

    const attempt = readAttempt(input, "identity")
    if (!attempt) throw new AuthApiError("invalidCode")
    await markIdentityVerified(internals, {
      sessionId: caller.sessionId,
      userId: caller.userId,
      code: input.code,
      attempt
    })

    // Re-sent so the browser keeps the attempt as long as the marker lives.
    return {
      data: undefined,
      status: 204,
      headers: new Headers({
        "set-cookie": attemptCookie(
          internals,
          "identity",
          attempt,
          input.requestURL
        )
      })
    }
  }
})
