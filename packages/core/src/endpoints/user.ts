import { AuthApiError, unauthenticated } from "../http/auth-api-error"
import { defineEndpoint } from "../http/define-endpoint"
import { readBody } from "../http/read-body"
import { validateAdditionalFields } from "../http/validate-additional-fields"
import { selectOne } from "../lib/select-one"
import type { EndpointDocs } from "../openapi/endpoint-docs"
import type { CallerInput } from "../session/authenticate"
import { authenticate } from "../session/authenticate"
import { clearedRefreshCookies } from "../session/session-cookies"
import { sessionAge } from "../session/session-token"
import type { AttemptInput } from "../shared/attempt-cookie"
import { readAttempt } from "../shared/attempt-cookie"
// Aliased: this file owns the HTTP names `updateUser` and `deleteUser`.
import { deleteUser as deleteUserAndRows } from "../user/delete-user"
import { updateUser as updateUserFields } from "../user/update-user"
import { requireVerifiedIdentity } from "../verification-code/identity"
import { accountIdentifier } from "../verification-code/resolve-code-identifier"

/**
 * The flat body accepted by `POST /user`.
 *
 * Flat because for this endpoint the whole payload *is* user fields — there are
 * no credentials mixed in, unlike sign-up, which is why sign-up keeps
 * `additionalFields` nested and this does not.
 */
export interface UpdateUserInput extends CallerInput {
  name?: string
  image?: string
  [field: string]: unknown
}

/** How `POST /user` appears in the OpenAPI document. */
export const updateUserDocs: EndpointDocs<UpdateUserInput> = {
  description:
    "Additional fields go at the top level. Email and phone cannot be changed here.",
  tag: "User",
  auth: "bearer",
  additionalFields: "flat",
  body: {
    type: "object",
    properties: { name: { type: "string" }, image: { type: "string" } }
  },
  responses: {
    200: { description: "The updated user.", schema: "User" },
    400: "InvalidField",
    401: "Unauthenticated"
  }
}

/**
 * Update the current user.
 *
 * `email` and `phoneNumber` are rejected rather than updated. An identifier is
 * the anchor every sign-in resolves to, so changing one re-keys the account —
 * that is a ceremony with a code verified at the *new* address, not a field you
 * can post. `type` is rejected for the obvious reason: it would be
 * self-promotion to admin.
 */
export const updateUser = defineEndpoint({
  method: "POST",
  path: "/user",
  parse: async ({ request, internals }): Promise<UpdateUserInput> => {
    const body = await readBody<UpdateUserInput>(request, [
      "name",
      "image",
      ...Object.keys(internals.config.user.additionalFields)
    ])

    return { ...body, headers: request.headers }
  },
  run: async (internals, input: UpdateUserInput) => {
    const caller = await authenticate(internals, input)

    const { headers: _headers, token: _token, name, image, ...rest } = input
    for (const [field, value] of [
      ["name", name],
      ["image", image]
    ] as const) {
      if (value !== undefined && typeof value !== "string") {
        throw new AuthApiError("invalidField", {
          message: `${field} must be a string.`
        })
      }
    }
    for (const rejected of [
      "email",
      "phoneNumber",
      "type",
      "id",
      "primaryUserId"
    ]) {
      if (rejected in rest) {
        throw new AuthApiError("invalidField", {
          message: `${rejected} cannot be changed here.`
        })
      }
    }

    const additionalFields = validateAdditionalFields(
      internals.config.user.additionalFields,
      rest
    )

    // An update that changes nothing is a client mistake, and saying so beats a
    // 200 that looks like success. Core would skip the write rather than send
    // an empty `SET`, so this is about answering the caller honestly rather
    // than about protecting the database.
    if (
      name === undefined &&
      image === undefined &&
      Object.keys(additionalFields).length === 0
    ) {
      throw new AuthApiError("invalidField", {
        message: "Provide at least one field to update."
      })
    }

    const current = await selectOne(internals, "users", {
      id: { eq: caller.userId }
    })
    if (!current) throw unauthenticated()

    const user = await updateUserFields(internals, current, {
      name,
      image,
      ...additionalFields
    })

    return { data: user }
  }
})

/** Body accepted by `DELETE /user`. */
export interface DeleteUserInput extends CallerInput, AttemptInput {
  requestURL?: string
}

/** How `DELETE /user` appears in the OpenAPI document. */
export const deleteUserDocs: EndpointDocs<DeleteUserInput> = {
  description:
    "Verify identity first with /user/verify. Only 204 means deleted.",
  tag: "User",
  auth: "bearer",
  body: {
    type: "object",
    properties: {
      attempt: {
        type: "string",
        description:
          "The token `/user/verify/send-code` returned. Browsers send it as a cookie instead."
      }
    }
  },
  responses: {
    204: { description: "Deleted.", setsCookie: "cleared" },
    401: "Unauthenticated",
    403: "VerificationRequired",
    409: "GuestCannotReceiveCode"
  }
}

/**
 * Delete the current user.
 *
 * Behind a verified identity, like revoking a device: a call without one
 * answers the challenge, the caller verifies with `/user/verify`, and
 * retries. There is no "signed in recently enough" bypass — a hijacked
 * session is exactly the one that is recent.
 *
 * The challenge deliberately answers 403 rather than 202: **204 must be the only
 * success shape**, or a client that treats any 2xx as done will clear its state
 * and tell the user their account is gone while it very much is not.
 */
export const deleteUser = defineEndpoint({
  method: "DELETE",
  path: "/user",
  parse: async ({ request }): Promise<DeleteUserInput> => {
    const body = await readBody<{ attempt?: string }>(request, ["attempt"])

    return { ...body, headers: request.headers, requestURL: request.url }
  },
  run: async (internals, input: DeleteUserInput) => {
    const headers = input.headers ?? new Headers()
    const caller = await authenticate(internals, input)

    // A session already revoked refuses the delete rather than honouring a
    // token that outlived it.
    const [user, session] = await Promise.all([
      selectOne(internals, "users", { id: { eq: caller.userId } }),
      selectOne(internals, "sessions", {
        id: { eq: caller.sessionId },
        ...sessionAge(internals).live
      })
    ])
    if (!user || !session) throw unauthenticated()

    const finishDeletion = async () => {
      await deleteUserAndRows(internals, user)

      const responseHeaders = new Headers()
      for (const cookie of clearedRefreshCookies(internals, {
        requestURL: input.requestURL,
        headers,
        userIds: [user.id]
      })) {
        responseHeaders.append("set-cookie", cookie)
      }

      return { data: undefined, status: 204, headers: responseHeaders }
    }

    // A guest with no identifier cannot be challenged at all.
    if (!accountIdentifier(user)) {
      throw new AuthApiError("guestCannotReceiveCode")
    }
    await requireVerifiedIdentity(
      internals,
      caller.sessionId,
      readAttempt(input, "identity")
    )
    return finishDeletion()
  }
})
