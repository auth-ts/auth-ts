import { AuthApiError } from "../../http/auth-api-error"
import { checkRateLimit } from "../../http/check-rate-limit"
import { defineEndpoint } from "../../http/define-endpoint"
import { validateAdditionalFields } from "../../http/validate-additional-fields"
import { getClientIp } from "../../lib/get-client-ip"
import type { IssueMode } from "../../session/issue-session"
import { issueSession } from "../../session/issue-session"

/** Body accepted by `POST /sign-in/guest`. */
export interface SignInGuestInput {
  additionalFields?: Record<string, unknown>
  mode?: IssueMode
  headers?: Headers
  requestURL?: string
}

/**
 * Signs in an anonymous user.
 *
 * A guest is a full user — real id, real session, real rows under row-level
 * security — which is what makes conversion later a rename rather than a
 * migration.
 *
 * Disabled unless `guest: true`, and rate limited per IP even then, because
 * anonymous account creation is an endpoint that writes a row for anyone who
 * asks. Worth telling users: a guest who loses the cookie loses the account,
 * until they connect a provider or verify an identifier.
 */
export const signInGuest = defineEndpoint({
  method: "POST",
  path: "/sign-in/guest",
  parse: async ({ request }): Promise<SignInGuestInput> => {
    const body = (await request.json().catch(() => ({}))) as SignInGuestInput

    return { ...body, headers: request.headers, requestURL: request.url }
  },
  run: async (internals, input: SignInGuestInput) => {
    const { config } = internals
    // Not merely disabled: absent. An endpoint that is off should look like an
    // endpoint that does not exist.
    if (!config.guest) throw new AuthApiError("notFound", 404)

    const headers = input.headers ?? new Headers()

    if (config.rateLimit !== false) {
      const clientIp = getClientIp(headers, config.clientIp)
      if (clientIp)
        await checkRateLimit(
          internals,
          `guest:ip:${clientIp}`,
          config.rateLimit.guestPerIP
        )
    }

    const additionalFields = validateAdditionalFields(
      config.user.additionalFields,
      input.additionalFields
    )

    // No identifier means the contract always inserts, which is what guest
    // creation is: a brand new row every time, never a lookup.
    const user = await internals.db.upsertUser({
      type: "guest",
      ...(Object.keys(additionalFields).length > 0 ? { additionalFields } : {})
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
