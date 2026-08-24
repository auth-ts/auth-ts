import { AuthApiError } from "../../http/auth-api-error"
import { checkRateLimit, ipRateLimitKey } from "../../http/check-rate-limit"
import { defineEndpoint } from "../../http/define-endpoint"
import { validateAdditionalFields } from "../../http/validate-additional-fields"
import { sha256Hex } from "../../lib/hash"
import { insertRow } from "../../lib/insert-row"
import { selectOne } from "../../lib/select-one"
import type { EndpointDocs } from "../../openapi/endpoint-docs"
import { issueSession } from "../../session/issue-session"
import { readRefreshToken } from "../../session/resolve-session"

/** Body accepted by `POST /sign-in/guest`. */
export interface SignInGuestInput {
  additionalFields?: Record<string, unknown>
  headers?: Headers
  requestURL?: string
}

/** How `POST /sign-in/guest` appears in the OpenAPI document. */
export const signInAsGuestDocs: EndpointDocs<SignInGuestInput> = {
  description: "Fails if this browser is already signed in.",
  tag: "Sign in",
  auth: "none",
  requires: "guest",
  additionalFields: "nested",
  body: { type: "object", properties: {} },
  responses: {
    200: {
      description: "Signed in as a new guest.",
      setsCookie: "refresh",
      schema: "TokenResult"
    },
    409: "Conflict",
    429: "RateLimited"
  }
}

/**
 * Sign in as a guest.
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
export const signInAsGuest = defineEndpoint({
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

    // A browser that is signed in never becomes a guest on top of it: the
    // guest would displace or park a real account, and a guest parked behind
    // one is a row nothing will ever convert. A dead cookie does not count.
    const presented = readRefreshToken(internals, headers)
    if (presented) {
      const live = await selectOne(internals, "sessions", {
        tokenHash: await sha256Hex(presented),
        expiresAt: { gt: new Date() }
      })
      if (live) throw new AuthApiError("guestRequiresSignOut", 409)
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
      image: null,
      primaryUserId: null,
      ...additionalFields,
      type: "guest"
    })

    const issued = await issueSession(internals, {
      user,
      headers,
      requestURL: input.requestURL
    })

    return {
      data: { user: issued.user, token: issued.token },
      headers: issued.headers
    }
  }
})
