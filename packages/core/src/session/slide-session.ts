import type { AuthInternals } from "../core/auth-internals"
import { defer } from "../lib/defer"
import { getIpAddress } from "../lib/ip-address"
import { parseDuration } from "../lib/parse-duration"
import { selectOne } from "../lib/select-one"

/**
 * How often a live session's row is written on use.
 *
 * A session is read on every refresh and written at most this often. Writing
 * on every request buys nothing: expiry measured to the hour is the same
 * policy as expiry measured to the millisecond, and a page load is otherwise
 * a database write.
 */
const SLIDE_INTERVAL = "1h"

/** User-agent and validated client IP for a session row, from the request headers. */
export function sessionStamp(internals: AuthInternals, headers: Headers) {
  const userAgent = headers.get("user-agent")
  const ipAddress = getIpAddress(headers, internals.config.ipAddress)

  return {
    ...(userAgent ? { userAgent } : {}),
    ...(ipAddress ? { ipAddress } : {})
  }
}

/**
 * Finds a live session by its token hash and, at most once an hour, marks it used.
 *
 * The read enforces liveness: a row whose `expiresAt` has passed matches
 * nothing. The write, when it is due, keeps the same predicate, so a session
 * revoked between the two cannot be revived by the write that was meant to
 * record activity on a live one.
 *
 * Recording the use is bookkeeping and happens whenever an hour has passed;
 * extending expiry is policy and answers to `session.sliding`. A deployment on
 * a fixed re-authentication interval still wants a device list that says when
 * each device was last seen.
 *
 * With `waitUntil` configured the write runs behind the response. What an
 * interrupted isolate can lose is one use-stamp — bookkeeping, never liveness.
 *
 * @returns The row as it now stands, or nothing when no live session matched.
 */
export async function slideSession(
  internals: AuthInternals,
  tokenHash: string,
  headers: Headers
) {
  const { sliding, ttl } = internals.config.session
  const { waitUntil } = internals.config

  const session = await selectOne(internals, "sessions", {
    tokenHash: { eq: tokenHash },
    expiresAt: { gt: new Date() }
  })
  if (!session) return []
  if (
    Date.now() - session.updatedAt.getTime() <
    parseDuration(SLIDE_INTERVAL)
  ) {
    return [session]
  }

  const written = {
    updatedAt: new Date(),
    ...sessionStamp(internals, headers),
    ...(sliding ? { expiresAt: new Date(Date.now() + parseDuration(ttl)) } : {})
  }
  const write = internals.db.update({
    table: "sessions",
    where: { tokenHash: { eq: tokenHash }, expiresAt: { gt: new Date() } },
    values: written
  })
  if (waitUntil) defer(internals, "session slide", write)
  else await write

  return [{ ...session, ...written }]
}
