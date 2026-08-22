import { AuthApiError } from "../http/auth-api-error"
import { checkRateLimit } from "../http/check-rate-limit"
import { defineEndpoint } from "../http/define-endpoint"
import { validateAdditionalFields } from "../http/validate-additional-fields"
import { getClientIp } from "../lib/get-client-ip"
import { consumeMagicCode } from "../magic-code/consume-magic-code"
import type { IdentifierBody } from "../magic-code/resolve-code-identifier"
import { resolveCodeIdentifier } from "../magic-code/resolve-code-identifier"
import { convertGuest } from "../session/convert-guest"
import type { IssueMode } from "../session/issue-session"
import { issueSession } from "../session/issue-session"
import { resolveSession } from "../session/resolve-session"

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

    // Validate the whole body before the code is spent. The code is a one-shot
    // credential, so a 400 here must be free to retry; burning it on a typo in
    // additionalFields would force the user to request another code.
    const additionalFields = validateAdditionalFields(
      internals.config.user.additionalFields,
      input.additionalFields
    )

    if (internals.config.rateLimit !== false) {
      const clientIp = getClientIp(headers, internals.config.clientIp)
      if (clientIp) {
        await checkRateLimit(
          internals,
          `verifyCode:ip:${clientIp}`,
          internals.config.rateLimit.verifyCodePerIP
        )
      }
    }

    await consumeMagicCode(internals, {
      identifier: identifier.value,
      code: input.code,
      purpose: "signIn"
    })

    const active = await resolveSession(internals, headers)
    const user =
      active?.user.type === "guest"
        ? (
            await convertGuest(internals, active.user, {
              [identifier.kind]: identifier.value,
              additionalFields
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
      ...(input.mode ? { mode: input.mode } : {}),
      // The guest's session has done its job either way — see `convertGuest`.
      ...(active?.user.type === "guest" ? { replaces: active.tokenHash } : {})
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
