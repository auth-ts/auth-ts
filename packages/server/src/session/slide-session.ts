import type { AuthServerInternals } from "../core/auth-server-internals"
import { getIpAddress } from "../lib/ip-address"
import { parseDuration } from "../lib/parse-duration"

/** User-agent and validated client IP for a session row, from the request headers. */
export function sessionStamp(internals: AuthServerInternals, headers: Headers) {
  const userAgent = headers.get("user-agent")
  const ipAddress = getIpAddress(headers, internals.config.ipAddress)

  return {
    ...(userAgent ? { userAgent } : {}),
    ...(ipAddress ? { ipAddress } : {})
  }
}

/**
 * Finds a live session by its token hash and marks it used, in one statement.
 *
 * The `where` is the whole safety property: a row whose `expiresAt` has passed
 * matches nothing, so an expired session can never be extended by the very
 * write that was meant to record activity on a live one. Nothing comes back and
 * the caller reads that as "no session".
 *
 * Recording the use is bookkeeping and always happens; extending expiry is
 * policy and answers to `session.sliding`. A deployment on a fixed
 * re-authentication interval still wants a device list that says when each
 * device was last seen.
 *
 * @returns The row as it now stands, or nothing when no live session matched.
 */
export function slideSession(
  internals: AuthServerInternals,
  tokenHash: string,
  headers: Headers
) {
  const { sliding, ttl } = internals.config.session

  return internals.db.update({
    table: "sessions",
    where: { tokenHash, expiresAt: { gt: new Date() } },
    values: {
      updatedAt: new Date(),
      ...sessionStamp(internals, headers),
      ...(sliding
        ? { expiresAt: new Date(Date.now() + parseDuration(ttl)) }
        : {})
    }
  })
}
