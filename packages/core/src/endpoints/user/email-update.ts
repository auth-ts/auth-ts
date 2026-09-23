import { AuthApiError, unauthenticated } from "../../http/auth-api-error"
import { defineEndpoint } from "../../http/define-endpoint"
import { readBody } from "../../http/read-body"
import { resolveLocale } from "../../http/resolve-locale"
import { defer } from "../../lib/defer"
import { verifyAccountIdentifierEmailAddressPattern } from "../../lib/normalize-identifiers"
import { selectOne } from "../../lib/select-one"
import { clearCookie, shouldUseSecureCookies } from "../../lib/serialize-cookie"
import type { EndpointDocs } from "../../openapi/endpoint-docs"
import type { CallerInput } from "../../session/authenticate"
import { authenticate } from "../../session/authenticate"
import { listUserSessions } from "../../session/list-user-sessions"
import { sessionAge } from "../../session/session-token"
import type { AttemptInput } from "../../shared/attempt-cookie"
import {
  attemptCookie,
  attemptCookieName,
  readAttempt
} from "../../shared/attempt-cookie"
import { updateUser } from "../../user/update-user"
import { consumeVerificationCode } from "../../verification-code/consume-verification-code"
import { requireVerifiedIdentity } from "../../verification-code/identity"
import { accountIdentifier } from "../../verification-code/resolve-code-identifier"
import { sendVerificationCode } from "../../verification-code/send-verification-code"

const ATTEMPT_DESCRIPTION =
  "The token `/user/verify/send-code` returned. Browsers send it as a cookie instead."

/** Body accepted by `POST /user/email-update/send-code`. */
export interface SendEmailUpdateCodeInput extends CallerInput, AttemptInput {
  /** The new address. */
  email: unknown
  requestURL?: string
}

/** How `POST /user/email-update/send-code` appears in the OpenAPI document. */
export const sendEmailUpdateCodeDocs: EndpointDocs<SendEmailUpdateCodeInput> = {
  description:
    "Verify identity first with /user/verify. The code goes to the new address; the account keeps the old one until the code is verified.",
  tag: "User",
  auth: "bearer",
  body: {
    type: "object",
    properties: {
      email: {
        type: "string",
        format: "email",
        description:
          "Lowercase; letters, digits and . _ + - before one @, a dotted domain after; at most 100 characters. Taken as sent, never modified."
      },
      attempt: { type: "string", description: ATTEMPT_DESCRIPTION }
    },
    required: ["email"]
  },
  responses: {
    200: {
      description:
        "Accepted for delivery. Browsers carry the attempt cookie to `/user/email-update/verify`; other callers present `attempt`.",
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
    400: "InvalidField",
    401: "Unauthenticated",
    403: "VerificationRequired",
    409: {
      description:
        "The address already belongs to an account (`emailTaken`), or the caller is a guest (`guestCannotReceiveCode`).",
      schema: "AuthError"
    },
    429: "RateLimited"
  }
}

async function verifiedCaller(
  internals: Parameters<typeof authenticate>[0],
  input: CallerInput & { attempt?: string }
) {
  const caller = await authenticate(internals, input)
  const [user, session] = await Promise.all([
    selectOne(internals, "users", { id: { eq: caller.userId } }),
    selectOne(internals, "sessions", {
      id: { eq: caller.sessionId },
      ...sessionAge(internals).live
    })
  ])
  if (!user || !session) throw unauthenticated()
  if (!accountIdentifier(user)) {
    throw new AuthApiError("guestCannotReceiveCode")
  }
  await requireVerifiedIdentity(
    internals,
    caller.sessionId,
    readAttempt(input, "identity")
  )

  return { caller, user }
}

function newAddress(
  internals: Parameters<typeof authenticate>[0],
  email: unknown
) {
  if (typeof email !== "string" || email.length === 0) {
    throw new AuthApiError("invalidField", {
      message: "An email address is required."
    })
  }
  if (!internals.config.email) throw new AuthApiError("channelNotConfigured")
  if (!verifyAccountIdentifierEmailAddressPattern(email)) {
    throw new AuthApiError("invalidEmailAddress")
  }

  return email
}

async function requireAvailable(
  internals: Parameters<typeof authenticate>[0],
  email: string
) {
  if (await selectOne(internals, "users", { email: { eq: email } })) {
    throw new AuthApiError("emailTaken")
  }
}

/**
 * Send an email update code.
 *
 * The author's flow: behind a verified identity, the new address is checked
 * against the book's rules and against every account, then a code goes to it.
 * The code is filed under the new address and bound to this browser, and
 * sends are limited per address, so nobody can flood an inbox they do not own.
 */
export const sendEmailUpdateCode = defineEndpoint({
  method: "POST",
  path: "/user/email-update/send-code",
  parse: async ({ request }): Promise<SendEmailUpdateCodeInput> => {
    const body = await readBody<{ email: unknown; attempt?: string }>(request, [
      "email",
      "attempt"
    ])

    return { ...body, headers: request.headers, requestURL: request.url }
  },
  run: async (internals, input: SendEmailUpdateCodeInput) => {
    const headers = input.headers ?? new Headers()
    await verifiedCaller(internals, input)
    const email = newAddress(internals, input.email)
    await requireAvailable(internals, email)

    const attempt = await sendVerificationCode(internals, {
      deliverTo: { kind: "email", value: email },
      key: email,
      purpose: "emailChange",
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
          "emailChange",
          attempt,
          input.requestURL
        )
      })
    }
  }
})

/** Body accepted by `POST /user/email-update/verify`. */
export interface VerifyEmailUpdateInput extends CallerInput {
  /** The new address, as sent to `/user/email-update/send-code`. */
  email: unknown
  code: string
  /** The token `/user/email-update/send-code` returned, for callers with no cookie jar. */
  attempt?: string
  /** The token `/user/verify/send-code` returned, for callers with no cookie jar. */
  identityAttempt?: string
  requestURL?: string
}

/** How `POST /user/email-update/verify` appears in the OpenAPI document. */
export const verifyEmailUpdateDocs: EndpointDocs<VerifyEmailUpdateInput> = {
  description:
    "Re-keys the account to the new address. Codes sent to the old address stop working, and the old address is told.",
  tag: "User",
  auth: "bearer",
  body: {
    type: "object",
    properties: {
      email: { type: "string", format: "email" },
      code: { type: "string" },
      attempt: {
        type: "string",
        description:
          "The token `/user/email-update/send-code` returned. Browsers send it as a cookie instead."
      },
      identityAttempt: { type: "string", description: ATTEMPT_DESCRIPTION }
    },
    required: ["email", "code"]
  },
  responses: {
    200: {
      description: "The user, carrying the new address.",
      setsCookie: "cleared",
      schema: "User"
    },
    400: "InvalidField",
    401: {
      description:
        "The code is wrong, expired, or already used, or the caller is not signed in. `code` says which.",
      schema: "AuthError"
    },
    403: "VerificationRequired",
    409: {
      description:
        "The address already belongs to an account (`emailTaken`), or the caller is a guest (`guestCannotReceiveCode`).",
      schema: "AuthError"
    },
    429: "RateLimited"
  }
}

/**
 * Verify an email update.
 *
 * The author's completion, step for step: the code is spent, the address is
 * checked to still be free, the user row is re-keyed, every code filed under
 * the old address or the user's sessions is deleted, and the old address is
 * told. Sessions stay signed in, as they do in his app.
 */
export const verifyEmailUpdate = defineEndpoint({
  method: "POST",
  path: "/user/email-update/verify",
  parse: async ({ request }): Promise<VerifyEmailUpdateInput> => {
    const body = await readBody<{
      email: unknown
      code: string
      attempt?: string
      identityAttempt?: string
    }>(request, ["email", "code", "attempt", "identityAttempt"])

    return { ...body, headers: request.headers, requestURL: request.url }
  },
  run: async (internals, input: VerifyEmailUpdateInput) => {
    const headers = input.headers ?? new Headers()
    const { user } = await verifiedCaller(internals, {
      ...input,
      attempt: input.identityAttempt
    })
    const email = newAddress(internals, input.email)
    if (typeof input.code !== "string" || input.code.length === 0) {
      throw new AuthApiError("invalidField", {
        message: "A code is required."
      })
    }

    await consumeVerificationCode(internals, {
      identifier: email,
      code: input.code,
      purpose: "emailChange",
      attempt: readAttempt(input, "emailChange"),
      guessKey: email
    })
    await requireAvailable(internals, email)

    const previous = user.email
    const [updated, sessions] = await Promise.all([
      updateUser(internals, user, { email }),
      listUserSessions(internals, user.id)
    ])
    for (const identifier of [
      previous,
      ...sessions.map((session) => session.id)
    ]) {
      if (!identifier) continue
      await internals.db.delete({
        table: "verifications",
        where: { identifier: { eq: identifier } }
      })
    }
    internals.log.info("email address changed")

    const notify = internals.config.email?.sendEmailChangedNotification
    if (notify && previous) {
      await defer(
        internals,
        "email changed notification",
        Promise.resolve().then(() =>
          notify({
            email: previous,
            user: updated,
            locale: resolveLocale(
              headers.get("accept-language"),
              internals.config.localization
            ),
            headers
          })
        )
      )
    }

    return {
      data: updated,
      headers: new Headers({
        "set-cookie": clearCookie(
          attemptCookieName("emailChange"),
          internals.config.basePath,
          shouldUseSecureCookies(input.requestURL)
        )
      })
    }
  }
})
