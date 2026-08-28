import type { AuthServerInternals } from "../core/auth-server-internals"
import { getIpAddress } from "../lib/ip-address"
import { parseDuration } from "../lib/parse-duration"
import { selectOne } from "../lib/select-one"

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
 * Finds a live session by its token hash and marks it used.
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
 * With `waitUntil` configured the answer comes from a read and the write runs
 * behind the response, so the hot path never blocks on a Postgres write. The
 * read enforces the same expiry predicate, and the deferred write keeps it too,
 * so a session revoked in the gap cannot be revived. What an interrupted
 * isolate can lose is one use-stamp — bookkeeping, never liveness. Without
 * `waitUntil` it stays one statement: two awaited would be strictly worse.
 *
 * @returns The row as it now stands, or nothing when no live session matched.
 */
export async function slideSession(
  internals: AuthServerInternals,
  tokenHash: string,
  headers: Headers
) {
  const { sliding, ttl } = internals.config.session
  const { waitUntil } = internals.config
  const values = () => ({
    updatedAt: new Date(),
    ...sessionStamp(internals, headers),
    ...(sliding ? { expiresAt: new Date(Date.now() + parseDuration(ttl)) } : {})
  })

  if (!waitUntil) {
    return internals.db.update({
      table: "sessions",
      where: { tokenHash, expiresAt: { gt: new Date() } },
      values: values()
    })
  }

  const session = await selectOne(internals, "sessions", {
    tokenHash,
    expiresAt: { gt: new Date() }
  })
  if (!session) return []

  const written = values()
  waitUntil(
    internals.db
      .update({
        table: "sessions",
        where: { tokenHash, expiresAt: { gt: new Date() } },
        values: written
      })
      .then(
        () => undefined,
        (error) =>
          internals.log.error("session slide failed", { error: String(error) })
      )
  )

  return [{ ...session, ...written }]
}
