import type { AuthInternals } from "../core/auth-internals"
import { AuthApiError } from "../http/auth-api-error"
import { sha256Hex } from "../lib/hash"
import { parseDuration } from "../lib/parse-duration"
import { selectOne } from "../lib/select-one"
import { matchVerificationCode } from "./consume-verification-code"
import { liveCode } from "./send-verification-code"

/** How long a verified identity lets its session act without asking again. */
export const IDENTITY_TTL = "1h"

/** What a spent identity code's `codeHash` becomes. Never a scrypt string, so no code matches it. */
const VERIFIED = "verified"

/** What verifying an identity code needs to know. */
export interface VerifyIdentityCodeInput {
  sessionId: string
  code: string
  attempt: string | null
}

/**
 * Checks an identity code and keeps its row as the marker, for an hour.
 *
 * The row is re-filed rather than deleted: its identifier is the session that
 * asked, its attempt hash is the browser that holds the cookie, so the marker
 * is bound to both without a table of its own. Overwriting `codeHash` is what
 * makes the code single-use — nothing matches `"verified"`.
 *
 * @throws {AuthApiError} `rateLimited` past the guess budget, `invalidCode` on any other failure.
 */
export async function markIdentityVerified(
  internals: AuthInternals,
  input: VerifyIdentityCodeInput
) {
  const stored = await matchVerificationCode(internals, {
    identifier: input.sessionId,
    code: input.code,
    purpose: "identity",
    attempt: input.attempt
  })

  const [marked] = await internals.db.update({
    table: "verifications",
    where: { id: { eq: stored.id }, ...liveCode() },
    values: { codeHash: VERIFIED, updatedAt: new Date() }
  })
  if (!marked) throw new AuthApiError("invalidCode")
}

/**
 * Refuses unless this session, in this browser, verified its identity within the hour.
 *
 * There is no "signed in recently enough" alternative. A hijacked session is
 * exactly the one that is recent; what it cannot produce is a code from the
 * owner's inbox.
 *
 * @throws {AuthApiError} `verificationRequired` when there is no live marker.
 */
export async function requireVerifiedIdentity(
  internals: AuthInternals,
  sessionId: string,
  attempt: string | null
) {
  if (!attempt) throw new AuthApiError("verificationRequired")

  const marker = await selectOne(internals, "verifications", {
    identifier: { eq: sessionId },
    purpose: { eq: "identity" },
    attemptHash: { eq: await sha256Hex(attempt) },
    updatedAt: { gt: new Date(Date.now() - parseDuration(IDENTITY_TTL)) }
  })
  if (marker?.codeHash !== VERIFIED) {
    throw new AuthApiError("verificationRequired")
  }
}
