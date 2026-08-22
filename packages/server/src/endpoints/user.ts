import { AuthApiError, unauthenticated } from "../http/auth-api-error"
import { defineEndpoint } from "../http/define-endpoint"
import { resolveLocale } from "../http/resolve-locale"
import { validateAdditionalFields } from "../http/validate-additional-fields"
import { parseDuration } from "../lib/parse-duration"
import { clearCookie, shouldUseSecureCookies } from "../lib/serialize-cookie"
import { consumeMagicCode } from "../magic-code/consume-magic-code"
import { sendMagicCode } from "../magic-code/send-magic-code"
import type { HeadersInput } from "../session/resolve-session"
import { resolveSession } from "../session/resolve-session"

/**
 * Reads the signed-in user.
 *
 * A cheap whoami for server-side rendering and app boot: it resolves the session
 * and returns the user without minting a token.
 */
export const getUser = defineEndpoint({
  method: "GET",
  path: "/user",
  parse: ({ request }): HeadersInput => ({ headers: request.headers }),
  run: async (internals, input: HeadersInput) => {
    const resolved = await resolveSession(internals, input.headers)
    if (!resolved) throw unauthenticated()

    return { data: { user: resolved.user } }
  }
})

/**
 * The flat body accepted by `PATCH /user`.
 *
 * Flat because for this endpoint the whole payload *is* user fields — there are
 * no credentials mixed in, unlike sign-up, which is why sign-up keeps
 * `additionalFields` nested and this does not.
 */
export interface UpdateUserInput {
  name?: string
  imageURL?: string
  headers?: Headers
  [field: string]: unknown
}

/**
 * Updates the fields core owns, plus any declared additional fields.
 *
 * `email` and `phoneNumber` are rejected rather than updated. An identifier is
 * the anchor every sign-in resolves to, so changing one re-keys the account —
 * that is a ceremony with a code verified at the *new* address, not a field you
 * can PATCH. `type` is rejected for the obvious reason: it would be
 * self-promotion to admin.
 */
export const updateUser = defineEndpoint({
  method: "PATCH",
  path: "/user",
  parse: async ({ request }): Promise<UpdateUserInput> => {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >

    return { ...body, headers: request.headers }
  },
  run: async (internals, input: UpdateUserInput) => {
    const headers = input.headers ?? new Headers()
    const resolved = await resolveSession(internals, headers)
    if (!resolved) throw unauthenticated()

    const { headers: _headers, name, imageURL, ...rest } = input
    for (const [field, value] of [
      ["name", name],
      ["imageURL", imageURL]
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

    // A PATCH that changes nothing is a client mistake, and saying so beats a
    // 200 that looks like success. It also never reaches the callback: an
    // `UPDATE … SET` with no columns is an error in most query builders, and
    // there is nothing for a consumer to do about a write that asks for nothing.
    if (
      name === undefined &&
      imageURL === undefined &&
      Object.keys(additionalFields).length === 0
    ) {
      throw new AuthApiError("invalidField", 400, {
        message: "Provide at least one field to update."
      })
    }

    const user = await internals.db.upsertUser({
      id: resolved.user.id,
      ...(name === undefined ? {} : { name }),
      ...(imageURL === undefined ? {} : { imageURL }),
      ...(Object.keys(additionalFields).length > 0 ? { additionalFields } : {})
    })

    return { data: { user } }
  }
})

/** Body accepted by `DELETE /user`. */
export interface DeleteUserInput {
  /** The confirmation code, when a challenge was issued. */
  code?: string
  headers?: Headers
  requestURL?: string
}

/**
 * Deletes the signed-in account.
 *
 * Two phases, in one endpoint. A session that authenticated recently deletes
 * immediately; an older one is challenged with a code first.
 *
 * The challenge deliberately answers 403 rather than 202: **204 must be the only
 * success shape**, or a client that treats any 2xx as done will clear its state
 * and tell the user their account is gone while it very much is not.
 *
 * The deletion code shares the one-live-code-per-identifier row with sign-in
 * codes, so a stranger spamming `/send-code` at this address keeps the
 * challenge inside the send cooldown. Bounded nuisance, not a bypass: the
 * purpose is checked on verify, so a sign-in code never authorizes a deletion.
 */
export const deleteUser = defineEndpoint({
  method: "DELETE",
  path: "/user",
  parse: async ({ request }): Promise<DeleteUserInput> => {
    const body = (await request.json().catch(() => ({}))) as { code?: string }

    return { ...body, headers: request.headers, requestURL: request.url }
  },
  run: async (internals, input: DeleteUserInput) => {
    const headers = input.headers ?? new Headers()
    const resolved = await resolveSession(internals, headers)
    if (!resolved) throw unauthenticated()

    const { config } = internals
    const { user, session } = resolved

    if (input.code) {
      const identifier = user.email ?? user.phoneNumber
      if (!identifier) throw new AuthApiError("guestCannotReceiveCode", 409)

      await consumeMagicCode(internals, {
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

    // Stale session: prove it is still the account holder before destroying data.
    const identifier = user.email
      ? ({ kind: "email", value: user.email } as const)
      : user.phoneNumber
        ? ({ kind: "phoneNumber", value: user.phoneNumber } as const)
        : null

    if (!identifier) throw new AuthApiError("guestCannotReceiveCode", 409)

    await sendMagicCode(internals, {
      identifier,
      purpose: "deleteUser",
      locale: resolveLocale(
        headers.get("accept-language"),
        config.localization
      ),
      headers
    })

    throw new AuthApiError("codeSent", 403)

    async function finishDeletion() {
      await internals.db.deleteUser({ id: user.id })

      const responseHeaders = new Headers()
      const secure = shouldUseSecureCookies(
        input.requestURL ?? "https://localhost"
      )
      responseHeaders.append(
        "set-cookie",
        clearCookie(config.cookie.name, config.cookie.path, secure)
      )
      if (config.multiAccount) {
        responseHeaders.append(
          "set-cookie",
          clearCookie(config.cookie.accountsName, config.cookie.path, secure)
        )
      }

      return { data: undefined, status: 204, headers: responseHeaders }
    }
  }
})
