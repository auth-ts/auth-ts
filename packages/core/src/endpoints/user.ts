import { AuthApiError, unauthenticated } from "../http/auth-api-error"
import { defineEndpoint } from "../http/define-endpoint"
import { readBody } from "../http/read-body"
import { validateAdditionalFields } from "../http/validate-additional-fields"
import { parseDuration } from "../lib/parse-duration"
import { selectOne } from "../lib/select-one"
import type { EndpointDocs } from "../openapi/endpoint-docs"
import type { CallerInput } from "../session/authenticate"
import { authenticate } from "../session/authenticate"
import { clearedRefreshCookies } from "../session/session-cookies"
// Aliased: this file owns the HTTP names `updateUser` and `deleteUser`.
import { deleteUser as deleteUserAndRows } from "../user/delete-user"
import { updateUser as updateUserFields } from "../user/update-user"
import { consumeVerificationCode } from "../verification-code/consume-verification-code"

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
        throw new AuthApiError("invalidField", 400, {
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
        throw new AuthApiError("invalidField", 400, {
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
      throw new AuthApiError("invalidField", 400, {
        message: "Provide at least one field to update."
      })
    }

    const current = await selectOne(internals, "users", { id: caller.userId })
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
export interface DeleteUserInput extends CallerInput {
  /** The confirmation code, when a challenge was issued. */
  code?: string
  requestURL?: string
}

/** How `DELETE /user` appears in the OpenAPI document. */
export const deleteUserDocs: EndpointDocs<DeleteUserInput> = {
  description:
    "An old session gets a code first — repeat the call with it. Only 204 means deleted.",
  tag: "User",
  auth: "bearer",
  body: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description: "The confirmation code, when one was issued."
      }
    }
  },
  responses: {
    204: { description: "Deleted.", setsCookie: "cleared" },
    401: "Unauthenticated",
    403: "StaleSession",
    409: "GuestCannotReceiveCode"
  }
}

/**
 * Delete the current user.
 *
 * Two phases, in one endpoint. A session that authenticated recently deletes
 * immediately; an older one must call `POST /user/send-delete-code` first and
 * retry with the code it sends.
 *
 * The challenge deliberately answers 403 rather than 202: **204 must be the only
 * success shape**, or a client that treats any 2xx as done will clear its state
 * and tell the user their account is gone while it very much is not.
 *
 * This endpoint never sends anything itself — a stale session refuses outright,
 * with no side effect, so retrying a failed delete cannot fire a storm of codes.
 * The purpose is checked on verify, so a sign-in code never authorizes a
 * deletion.
 */
export const deleteUser = defineEndpoint({
  method: "DELETE",
  path: "/user",
  parse: async ({ request }): Promise<DeleteUserInput> => {
    const body = await readBody<{ code?: string }>(request, ["code"])

    return { ...body, headers: request.headers, requestURL: request.url }
  },
  run: async (internals, input: DeleteUserInput) => {
    const headers = input.headers ?? new Headers()
    const caller = await authenticate(internals, input)

    const { config } = internals
    // The fresh window is measured from the session, and a session already
    // revoked refuses the delete rather than honouring a token that outlived it.
    const [user, session] = await Promise.all([
      selectOne(internals, "users", { id: caller.userId }),
      selectOne(internals, "sessions", {
        id: caller.sessionId,
        expiresAt: { gt: new Date() }
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

    if (input.code) {
      const identifier = user.email ?? user.phoneNumber
      if (!identifier) throw new AuthApiError("guestCannotReceiveCode", 409)

      await consumeVerificationCode(internals, {
        identifier,
        code: input.code,
        purpose: "deleteUser"
      })
      return finishDeletion()
    }

    // Strictly less than, so that a window of "0s" means what it says: always
    // require the code. With `<=`, a session created in the same millisecond as
    // the request would satisfy a zero-length window and delete outright.
    const authenticatedAgo = Date.now() - session.createdAt.getTime()
    if (authenticatedAgo < parseDuration(config.user.deleteFreshWindow)) {
      return finishDeletion()
    }

    // A guest with no identifier still can't be challenged at all.
    if (!user.email && !user.phoneNumber) {
      throw new AuthApiError("guestCannotReceiveCode", 409)
    }

    throw new AuthApiError("staleSession", 403)
  }
})
