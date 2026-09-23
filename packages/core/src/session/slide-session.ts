import type { AuthInternals } from "../core/auth-internals"
import { defer } from "../lib/defer"
import { getIpAddress } from "../lib/ip-address"
import { parseDuration } from "../lib/parse-duration"
import type { SessionCredential } from "./session-token"
import { findSession, sessionAge } from "./session-token"

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

/** Finds a live session and, at most hourly, stamps its use. */
export async function slideSession(
  internals: AuthInternals,
  credential: SessionCredential,
  headers: Headers
) {
  const { waitUntil } = internals.config

  const session = await findSession(internals, credential)
  if (!session) return []
  if (
    Date.now() - session.updatedAt.getTime() <
    parseDuration(SLIDE_INTERVAL)
  ) {
    return [session]
  }

  const written = { updatedAt: new Date(), ...sessionStamp(internals, headers) }
  const write = internals.db.update({
    table: "sessions",
    // Never revives a session revoked meanwhile
    where: { id: { eq: session.id }, ...sessionAge(internals).live },
    values: written
  })
  if (waitUntil) defer(internals, "session slide", write)
  else await write

  return [{ ...session, ...written }]
}
