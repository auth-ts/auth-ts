import { AuthApiError } from "../http/auth-api-error.ts"
import { checkRateLimit } from "../http/check-rate-limit.ts"
import { defineEndpoint } from "../http/define-endpoint.ts"
import { validateAdditionalFields } from "../http/validate-additional-fields.ts"
import { getClientIp } from "../lib/get-client-ip.ts"
import { consumeMagicCode } from "../magic-code/consume-magic-code.ts"
import type { IdentifierBody } from "../magic-code/resolve-code-identifier.ts"
import { resolveCodeIdentifier } from "../magic-code/resolve-code-identifier.ts"
import { convertGuest } from "../session/convert-guest.ts"
import type { IssueMode } from "../session/issue-session.ts"
import { issueSession } from "../session/issue-session.ts"
import { resolveSession } from "../session/resolve-session.ts"

/** Body accepted by `POST /verify-code`. */
export interface VerifyCodeInput extends IdentifierBody {
  code: string
  /** `"token"` returns the refresh token in the body, for native clients. */
  mode?: IssueMode
  /** Values for fields declared in `user.additionalFields`, applied on creation only. */
  additionalFields?: Record<string, unknown>
  headers?: Headers
  requestURL?: string
}

/**
 * Verifies a code and starts a session.
 *
 * Creating the user happens here rather than at send time, which is what makes
 * `send-code` safe to answer identically for everyone.
 *
 * If the caller is currently a guest, this completes their conversion — either
 * upgrading the guest row in place or attaching it to the account that already
 * owns the identifier.
 */
export const verifyCode = defineEndpoint({
  method: "POST",
  path: "/verify-code",
  parse: async ({ request }): Promise<VerifyCodeInput> => {
    const body = (await request.json().catch(() => ({}))) as VerifyCodeInput

    return { ...body, headers: request.headers, requestURL: request.url }
  },
  run: async (internals, input: VerifyCodeInput) => {
    const headers = input.headers ?? new Headers()
    const identifier = resolveCodeIdentifier(internals, input)

    if (typeof input.code !== "string" || input.code.length === 0) {
      throw new AuthApiError("invalidField", 400, {
        message: "A code is required."
      })
    }

    if (internals.options.rateLimit !== false) {
      const clientIp = getClientIp(headers, internals.options.clientIp)
      if (clientIp) {
        await checkRateLimit(
          internals,
          `verifyCode:ip:${clientIp}`,
          internals.options.rateLimit.verifyCodePerIP
        )
      }
    }

    await consumeMagicCode(internals, {
      identifier: identifier.value,
      code: input.code,
      purpose: "signIn"
    })

    const additionalFields = validateAdditionalFields(
      internals.options.user.additionalFields,
      input.additionalFields
    )

    const active = await resolveSession(internals, headers)
    const user =
      active?.user.type === "guest"
        ? (
            await convertGuest(internals, active.user, {
              [identifier.kind]: identifier.value
            })
          ).user
        : await internals.db.upsertUser({
            [identifier.kind]: identifier.value,
            type: "user",
            ...(Object.keys(additionalFields).length > 0
              ? { additionalFields }
              : {})
          })

    const issued = await issueSession(internals, {
      user,
      headers,
      requestURL: input.requestURL ?? "https://localhost",
      ...(input.mode ? { mode: input.mode } : {})
    })

    return {
      data: {
        accessToken: issued.accessToken,
        user: issued.user,
        ...(issued.refreshToken ? { refreshToken: issued.refreshToken } : {})
      },
      headers: issued.headers
    }
  }
})
