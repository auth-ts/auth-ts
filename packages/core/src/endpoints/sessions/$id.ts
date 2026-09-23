import { notFound } from "../../http/auth-api-error"
import { defineEndpoint } from "../../http/define-endpoint"
import { readBody } from "../../http/read-body"
import type { EndpointDocs } from "../../openapi/endpoint-docs"
import type { CallerInput } from "../../session/authenticate"
import { authenticateUser } from "../../session/authenticate"
import { deleteSessions } from "../../session/delete-sessions"
import type { AttemptInput } from "../../shared/attempt-cookie"
import { readAttempt } from "../../shared/attempt-cookie"
import { requireVerifiedIdentity } from "../../verification-code/identity"

/** Input for revoking one of the caller's sessions. */
export interface RevokeSessionInput extends CallerInput, AttemptInput {
  /** The session's own id, from your `sessions` table. */
  id: string
}

/** How `DELETE /sessions/$id` appears in the OpenAPI document. */
export const revokeSessionDocs: EndpointDocs<RevokeSessionInput, "id"> = {
  description:
    "Verify identity first with /user/verify. To sign this device out, call /sign-out instead: only that clears the cookie.",
  tag: "User",
  auth: "bearer",
  params: { id: "The session's id, from your `sessions` table." },
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
    204: { description: "Revoked." },
    401: "Unauthenticated",
    403: "VerificationRequired",
    404: "NotFound"
  }
}

/**
 * Revoke a session.
 *
 * Signing out one other device is the action a hijacker would use to keep
 * the owner out, so it needs a verified identity rather than a bearer token
 * alone. The device it names stops refreshing at once and its current access
 * token runs out within `jwt.ttl`.
 *
 * @throws {AuthApiError} `verificationRequired` without a live marker, and
 * `notFound` for a session that is not the caller's.
 */
export const revokeSession = defineEndpoint({
  method: "DELETE",
  path: "/sessions/$id",
  parse: async ({ request, params }): Promise<RevokeSessionInput> => {
    const body = await readBody<{ attempt?: string }>(request, ["attempt"])

    return { ...body, id: params.id ?? "", headers: request.headers }
  },
  run: async (internals, input: RevokeSessionInput) => {
    const { caller } = await authenticateUser(internals, input)

    await requireVerifiedIdentity(
      internals,
      caller.sessionId,
      readAttempt(input, "identity")
    )

    const [revoked] = await deleteSessions(internals, {
      id: { eq: input.id },
      userId: { eq: caller.userId }
    })
    if (!revoked) throw notFound()

    return { data: undefined, status: 204 }
  }
})
