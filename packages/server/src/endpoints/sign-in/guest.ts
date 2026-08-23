import { AuthApiError } from "../../http/auth-api-error"
import { checkRateLimit, ipRateLimitKey } from "../../http/check-rate-limit"
import { defineEndpoint } from "../../http/define-endpoint"
import { validateAdditionalFields } from "../../http/validate-additional-fields"
import { insertRow } from "../../lib/insert-row"
import { TOKEN_HEADER } from "../../session/authenticate"
import { issueSession } from "../../session/issue-session"

/** Body accepted by `POST /sign-in/guest`. */
export interface SignInGuestInput {
  additionalFields?: Record<string, unknown>
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
      const ipKey = ipRateLimitKey(internals, headers, "guest")
      if (ipKey)
        await checkRateLimit(internals, ipKey, config.rateLimit.guestPerIP)
    }

    const additionalFields = validateAdditionalFields(
      config.user.additionalFields,
      input.additionalFields
    )

    // A brand new row every time, never a lookup: an anonymous account has no
    // identifier to find it by, which is exactly what makes it anonymous.
    const user = await insertRow(internals, "users", {
      email: null,
      phoneNumber: null,
      name: null,
      imageURL: null,
      primaryUserId: null,
      ...additionalFields,
      type: "guest"
    })

    const issued = await issueSession(internals, {
      user,
      headers,
      requestURL: input.requestURL
    })

    const responseHeaders = new Headers(issued.headers)
    responseHeaders.set(TOKEN_HEADER, issued.token)

    return { data: { user: issued.user }, headers: responseHeaders }
  }
})
