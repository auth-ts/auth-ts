import { AuthApiError } from "../../http/auth-api-error"
import { defineEndpoint } from "../../http/define-endpoint"
import { readBody } from "../../http/read-body"
import { validateAdditionalFields } from "../../http/validate-additional-fields"
import type { EndpointDocs } from "../../openapi/endpoint-docs"
import { convertGuest } from "../../session/convert-guest"
import { issueSession } from "../../session/issue-session"
import { notifySignedIn } from "../../session/notify-signed-in"
import { resolveCallerSession } from "../../session/resolve-session"
import type { AttemptInput } from "../../shared/attempt-cookie"
import { readAttempt } from "../../shared/attempt-cookie"
import { findOrCreateUser } from "../../user/find-or-create-user"
import { consumeVerificationCode } from "../../verification-code/consume-verification-code"
import type { IdentifierBody } from "../../verification-code/resolve-code-identifier"
import { resolveCodeIdentifier } from "../../verification-code/resolve-code-identifier"

/** Body accepted by `POST /sign-in/code`. */
export interface SignInWithCodeInput extends IdentifierBody, AttemptInput {
  code: string
  /** Values for fields declared in `user.additionalFields`, applied on creation only. */
  additionalFields?: Record<string, unknown>
  requestURL?: string
}

/** How `POST /sign-in/code` appears in the OpenAPI document. */
export const signInWithCodeDocs: EndpointDocs<SignInWithCodeInput> = {
  description: "A rejected body does not use up the code.",
  tag: "Sign in",
  auth: "none",
  additionalFields: "nested",
  body: {
    type: "object",
    properties: {
      email: {
        type: "string",
        format: "email",
        description:
          "Lowercase; letters, digits and . _ + - before one @, a dotted domain after; at most 100 characters. Taken as sent, never modified."
      },
      phoneNumber: { type: "string", description: "E.164." },
      code: { type: "string" },
      attempt: {
        type: "string",
        description:
          "The token `/sign-in/send-code` returned. Browsers send it as a cookie instead."
      }
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
    401: {
      description: "The code is wrong, expired, or already used.",
      schema: "AuthError"
    },
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
      "attempt",
      "additionalFields"
    ])

    return { ...body, headers: request.headers, requestURL: request.url }
  },
  run: async (internals, input: SignInWithCodeInput) => {
    const headers = input.headers ?? new Headers()
    const identifier = resolveCodeIdentifier(internals, input)

    if (typeof input.code !== "string" || input.code.length === 0) {
      throw new AuthApiError("invalidField", {
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

    const [, active] = await Promise.all([
      consumeVerificationCode(internals, {
        identifier: identifier.value,
        code: input.code,
        purpose: "signIn",
        attempt: readAttempt(input, "signIn"),
        guessKey: identifier.value
      }),
      resolveCallerSession(internals, input)
    ])
    const { user, created } =
      active?.user.type === "guest"
        ? await convertGuest(internals, active.user, {
            [identifier.kind]: identifier.value,
            additionalFields
          }).then(({ user, outcome }) => ({
            user,
            created: outcome === "upgraded"
          }))
        : await findOrCreateUser(internals, { identifier, additionalFields })

    const issued = await issueSession(internals, {
      user,
      headers,
      amr: [identifier.kind === "email" ? "otp" : "sms"],
      requestURL: input.requestURL,
      caller: active
    })
    if (!created) await notifySignedIn(internals, { ...issued, headers })

    return {
      data: { user: issued.user, token: issued.token },
      headers: issued.headers
    }
  }
})
