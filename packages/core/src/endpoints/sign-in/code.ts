import { AuthApiError } from "../../http/auth-api-error"
import { checkRateLimit, ipRateLimitKey } from "../../http/check-rate-limit"
import { defineEndpoint } from "../../http/define-endpoint"
import { readBody } from "../../http/read-body"
import { validateAdditionalFields } from "../../http/validate-additional-fields"
import type { EndpointDocs } from "../../openapi/endpoint-docs"
import { convertGuest } from "../../session/convert-guest"
import { issueSession } from "../../session/issue-session"
import { resolveCallerSession } from "../../session/resolve-session"
import { findOrCreateUser } from "../../user/find-or-create-user"
import { consumeVerificationCode } from "../../verification-code/consume-verification-code"
import type { IdentifierBody } from "../../verification-code/resolve-code-identifier"
import { resolveCodeIdentifier } from "../../verification-code/resolve-code-identifier"

/** Body accepted by `POST /sign-in/code`. */
export interface SignInWithCodeInput extends IdentifierBody {
  code: string
  /** Values for fields declared in `user.additionalFields`, applied on creation only. */
  additionalFields?: Record<string, unknown>
  headers?: Headers
  requestURL?: string
}

/** How `POST /sign-in/code` appears in the OpenAPI document. */
export const signInWithCodeDocs: EndpointDocs<SignInWithCodeInput> = {
  description: "A failed request does not use up the code.",
  tag: "Sign in",
  auth: "none",
  additionalFields: "nested",
  body: {
    type: "object",
    properties: {
      email: { type: "string", format: "email" },
      phoneNumber: { type: "string", description: "E.164." },
      code: { type: "string" }
    },
    required: ["code"]
  },
  responses: {
    200: {
      description: "Signed in.",
      setsCookie: "refresh",
      schema: "TokenResult"
    },
    400: "InvalidField",
    429: "RateLimited"
  }
}

/**
 * Sign in with a code.
 *
 * Creating the user happens here rather than at send time, which is what makes
 * `sign-in/send-code` safe to answer identically for everyone.
 *
 * If the caller is currently a guest, this completes their conversion — either
 * upgrading the guest row in place or attaching it to the account that already
 * owns the identifier.
 */
export const signInWithCode = defineEndpoint({
  method: "POST",
  path: "/sign-in/code",
  parse: async ({ request }): Promise<SignInWithCodeInput> => {
    const body = await readBody<SignInWithCodeInput>(request, [
      "email",
      "phoneNumber",
      "code",
      "additionalFields"
    ])

    return { ...body, headers: request.headers, requestURL: request.url }
  },
  run: async (internals, input: SignInWithCodeInput) => {
    const headers = input.headers ?? new Headers()
    const identifier = resolveCodeIdentifier(internals, input)

    if (typeof input.code !== "string" || input.code.length === 0) {
      throw new AuthApiError("invalidField", 400, {
        message: "A code is required."
      })
    }

    // Validate the whole body before the code is spent. The code is a one-shot
    // credential, so a 400 here must be free to retry; burning it on a typo in
    // additionalFields would force the user to request another code.
    const additionalFields = validateAdditionalFields(
      internals.config.user.additionalFields,
      input.additionalFields
    )

    if (internals.config.rateLimit !== false) {
      const ipKey = ipRateLimitKey(internals, headers, "signInCode")
      if (ipKey) {
        await checkRateLimit(
          internals,
          ipKey,
          internals.config.rateLimit.signInCodePerIP
        )
      }
    }

    const [, active] = await Promise.all([
      consumeVerificationCode(internals, {
        identifier: identifier.value,
        code: input.code,
        purpose: "signIn"
      }),
      resolveCallerSession(internals, input)
    ])
    const user =
      active?.user.type === "guest"
        ? (
            await convertGuest(internals, active.user, {
              [identifier.kind]: identifier.value,
              additionalFields
            })
          ).user
        : await findOrCreateUser(internals, { identifier, additionalFields })

    const issued = await issueSession(internals, {
      user,
      headers,
      amr: [identifier.kind === "email" ? "otp" : "sms"],
      requestURL: input.requestURL,
      // The guest's session has done its job either way — see `convertGuest`.
      ...(active?.user.type === "guest" ? { replaces: active.tokenHash } : {})
    })

    return {
      data: { user: issued.user, token: issued.token },
      headers: issued.headers
    }
  }
})
