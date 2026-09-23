import type { AuthConfig } from "../../core/auth-config"
import type { VerificationPurpose } from "../../core/auth-database"
import type { AuthInternals } from "../../core/auth-internals"
import type { ChangedNotificationContext } from "../../core/auth-options"
import { AuthApiError } from "../../http/auth-api-error"
import { defineEndpoint } from "../../http/define-endpoint"
import type { AuthErrorCode } from "../../http/error-response"
import { readBody } from "../../http/read-body"
import { resolveLocale } from "../../http/resolve-locale"
import { defer } from "../../lib/defer"
import { selectOne } from "../../lib/select-one"
import { clearCookie, shouldUseSecureCookies } from "../../lib/serialize-cookie"
import type { AnyEndpointDocs } from "../../openapi/endpoint-docs"
import type { JsonSchema } from "../../openapi/json-schema"
import type { CallerInput } from "../../session/authenticate"
import { authenticateUser } from "../../session/authenticate"
import { listUserSessions } from "../../session/list-user-sessions"
import type { AttemptInput } from "../../shared/attempt-cookie"
import {
  attemptCookie,
  attemptCookieName,
  readAttempt
} from "../../shared/attempt-cookie"
import { updateUser } from "../../user/update-user"
import { consumeVerificationCode } from "../../verification-code/consume-verification-code"
import { requireVerifiedIdentity } from "../../verification-code/identity"
import {
  accountIdentifier,
  resolveCodeIdentifier
} from "../../verification-code/resolve-code-identifier"
import { sendVerificationCode } from "../../verification-code/send-verification-code"

type IdentifierKind = "email" | "phoneNumber"

/** Body accepted by `POST /user/<route>/send-code`. */
export type SendUpdateCodeInput<K extends IdentifierKind> = CallerInput &
  AttemptInput &
  Record<K, unknown> & { requestURL?: string }

/** Body accepted by `POST /user/<route>/verify`. */
export type VerifyUpdateInput<K extends IdentifierKind> = CallerInput &
  Record<K, unknown> & {
    code: string
    /** The token the send returned, for callers with no cookie jar. */
    attempt?: string
    /** The token `/user/verify/send-code` returned, for callers with no cookie jar. */
    identityAttempt?: string
    requestURL?: string
  }

interface UpdateSpec<K extends IdentifierKind> {
  kind: K
  route: string
  purpose: VerificationPurpose
  taken: AuthErrorCode
  noun: string
  property: JsonSchema
  notify(
    config: AuthConfig,
    previous: string,
    context: ChangedNotificationContext
  ): Promise<void> | void
}

const IDENTITY_ATTEMPT =
  "The token `/user/verify/send-code` returned. Browsers send it as a cookie instead."

async function verifiedCaller(
  internals: AuthInternals,
  input: CallerInput & { attempt?: string }
) {
  const { caller, user } = await authenticateUser(internals, input)
  if (!accountIdentifier(user)) {
    throw new AuthApiError("guestCannotReceiveCode")
  }
  await requireVerifiedIdentity(
    internals,
    caller.sessionId,
    readAttempt(input, "identity")
  )

  return user
}

async function newIdentifier<K extends IdentifierKind>(
  internals: AuthInternals,
  spec: UpdateSpec<K>,
  value: unknown
) {
  if (typeof value !== "string" || value.length === 0) {
    throw new AuthApiError("invalidField", {
      message: `A ${spec.noun} is required.`
    })
  }
  const identifier = resolveCodeIdentifier(internals, { [spec.kind]: value })
  if (
    await selectOne(internals, "users", {
      [spec.kind]: { eq: identifier.value }
    })
  ) {
    throw new AuthApiError(spec.taken)
  }

  return identifier
}

function taken(spec: UpdateSpec<IdentifierKind>) {
  return {
    description: `The ${spec.noun} already belongs to an account (\`${spec.taken}\`), or the caller is a guest (\`guestCannotReceiveCode\`).`,
    schema: "AuthError" as const
  }
}

function updateEndpoints<K extends IdentifierKind>(spec: UpdateSpec<K>) {
  const sendCodeDocs: AnyEndpointDocs = {
    description: `Verify identity first with /user/verify. The code goes to the new ${spec.noun}; the account keeps the old one until the code is verified.`,
    tag: "User",
    auth: "bearer",
    body: {
      type: "object",
      properties: {
        [spec.kind]: spec.property,
        attempt: { type: "string", description: IDENTITY_ATTEMPT }
      },
      required: [spec.kind]
    },
    responses: {
      200: {
        description: `Accepted for delivery. Browsers carry the attempt cookie to \`/user/${spec.route}/verify\`; other callers present \`attempt\`.`,
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
      409: taken(spec),
      429: "RateLimited"
    }
  }

  const sendCode = defineEndpoint({
    method: "POST",
    path: `/user/${spec.route}/send-code`,
    parse: async ({ request }): Promise<SendUpdateCodeInput<K>> => {
      const body = await readBody<Record<K, unknown> & { attempt?: string }>(
        request,
        [spec.kind, "attempt"]
      )

      return { ...body, headers: request.headers, requestURL: request.url }
    },
    run: async (internals, input: SendUpdateCodeInput<K>) => {
      const headers = input.headers ?? new Headers()
      await verifiedCaller(internals, input)
      const identifier = await newIdentifier(internals, spec, input[spec.kind])

      const attempt = await sendVerificationCode(internals, {
        deliverTo: identifier,
        key: identifier.value,
        purpose: spec.purpose,
        limit: { key: `send:${identifier.value}`, bucket: "sends" },
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
            spec.purpose,
            attempt,
            input.requestURL
          )
        })
      }
    }
  })

  const verifyDocs: AnyEndpointDocs = {
    description: `Re-keys the account to the new ${spec.noun}. Codes sent to the old one stop working, and the old one is told.`,
    tag: "User",
    auth: "bearer",
    body: {
      type: "object",
      properties: {
        [spec.kind]: spec.property,
        code: { type: "string" },
        attempt: {
          type: "string",
          description: `The token \`/user/${spec.route}/send-code\` returned. Browsers send it as a cookie instead.`
        },
        identityAttempt: { type: "string", description: IDENTITY_ATTEMPT }
      },
      required: [spec.kind, "code"]
    },
    responses: {
      200: {
        description: `The user, carrying the new ${spec.noun}.`,
        setsCookie: "cleared",
        schema: "User"
      },
      400: "InvalidField",
      401: {
        description:
          "`incorrectCode` for a wrong code; `invalidCode` when it expired, was used, or was requested elsewhere; `unauthenticated` when not signed in.",
        schema: "AuthError"
      },
      403: "VerificationRequired",
      409: taken(spec),
      429: "RateLimited"
    }
  }

  const verify = defineEndpoint({
    method: "POST",
    path: `/user/${spec.route}/verify`,
    parse: async ({ request }): Promise<VerifyUpdateInput<K>> => {
      const body = await readBody<
        Record<K, unknown> & {
          code: string
          attempt?: string
          identityAttempt?: string
        }
      >(request, [spec.kind, "code", "attempt", "identityAttempt"])

      return { ...body, headers: request.headers, requestURL: request.url }
    },
    run: async (internals, input: VerifyUpdateInput<K>) => {
      const headers = input.headers ?? new Headers()
      const user = await verifiedCaller(internals, {
        ...input,
        attempt: input.identityAttempt
      })
      if (typeof input.code !== "string" || input.code.length === 0) {
        throw new AuthApiError("invalidField", {
          message: "A code is required."
        })
      }
      const identifier = await newIdentifier(internals, spec, input[spec.kind])

      await consumeVerificationCode(internals, {
        identifier: identifier.value,
        code: input.code,
        purpose: spec.purpose,
        attempt: readAttempt(input, spec.purpose),
        guessKey: identifier.value
      })
      // Claimed between the send and the verify: the re-check catches it.
      await newIdentifier(internals, spec, identifier.value)

      const previous = user[spec.kind]
      const [updated, sessions] = await Promise.all([
        updateUser(internals, user, { [spec.kind]: identifier.value }).catch(
          async (error: unknown) => {
            // Lost a race for the address
            await newIdentifier(internals, spec, identifier.value)
            throw error
          }
        ),
        listUserSessions(internals, user.id)
      ])
      for (const key of [previous, ...sessions.map((session) => session.id)]) {
        if (!key) continue
        await internals.db.delete({
          table: "verifications",
          where: { identifier: { eq: key } }
        })
      }
      internals.log.info(`${spec.noun} changed`)

      if (previous) {
        await defer(
          internals,
          `${spec.noun} changed notification`,
          Promise.resolve().then(() =>
            spec.notify(internals.config, previous, {
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
            attemptCookieName(spec.purpose),
            internals.config.basePath,
            shouldUseSecureCookies(input.requestURL)
          )
        })
      }
    }
  })

  return { sendCode, sendCodeDocs, verify, verifyDocs }
}

const email = updateEndpoints({
  kind: "email",
  route: "email-update",
  purpose: "emailChange",
  taken: "emailTaken",
  noun: "email address",
  property: {
    type: "string",
    format: "email",
    description:
      "Lowercase; letters, digits and . _ + - before one @, a dotted domain after; at most 100 characters. Taken as sent, never modified."
  },
  notify: (config, previous, context) =>
    config.email?.sendEmailChangedNotification?.({
      email: previous,
      ...context
    })
})

const phone = updateEndpoints({
  kind: "phoneNumber",
  route: "phone-update",
  purpose: "phoneChange",
  taken: "phoneNumberTaken",
  noun: "phone number",
  property: { type: "string", description: "E.164, e.g. `+15551234567`." },
  notify: (config, previous, context) =>
    config.sms?.sendPhoneNumberChangedNotification?.({
      phoneNumber: previous,
      ...context
    })
})

/** Body accepted by `POST /user/email-update/send-code`. */
export type SendEmailUpdateCodeInput = SendUpdateCodeInput<"email">
/** Body accepted by `POST /user/email-update/verify`. */
export type VerifyEmailUpdateInput = VerifyUpdateInput<"email">
/** Body accepted by `POST /user/phone-update/send-code`. */
export type SendPhoneUpdateCodeInput = SendUpdateCodeInput<"phoneNumber">
/** Body accepted by `POST /user/phone-update/verify`. */
export type VerifyPhoneUpdateInput = VerifyUpdateInput<"phoneNumber">

/** How `POST /user/email-update/send-code` appears in the OpenAPI document. */
export const sendEmailUpdateCodeDocs = email.sendCodeDocs
/** How `POST /user/email-update/verify` appears in the OpenAPI document. */
export const verifyEmailUpdateDocs = email.verifyDocs
/** How `POST /user/phone-update/send-code` appears in the OpenAPI document. */
export const sendPhoneUpdateCodeDocs = phone.sendCodeDocs
/** How `POST /user/phone-update/verify` appears in the OpenAPI document. */
export const verifyPhoneUpdateDocs = phone.verifyDocs

/**
 * Send an email update code.
 *
 * The author's flow: behind a verified identity, the new address is checked
 * against the book's rules and against every account, then a code goes to it.
 * The code is filed under the new address and bound to this browser, and
 * sends are limited per address, so nobody can flood an inbox they do not own.
 */
export const sendEmailUpdateCode = email.sendCode

/**
 * Verify an email update.
 *
 * The author's completion, step for step: the code is spent, the address is
 * checked to still be free, the user row is re-keyed, every code filed under
 * the old address or the user's sessions is deleted, and the old address is
 * told. Sessions stay signed in, as they do in his app.
 */
export const verifyEmailUpdate = email.verify

/**
 * Send a phone update code.
 *
 * The email flow, texted: the new number is normalized to E.164, checked
 * against every account, and sent a code filed under it.
 */
export const sendPhoneUpdateCode = phone.sendCode

/**
 * Verify a phone update.
 *
 * The email completion for a number: the code is spent, the row re-keyed,
 * codes under the old number and the user's sessions deleted, the old number
 * told.
 */
export const verifyPhoneUpdate = phone.verify
